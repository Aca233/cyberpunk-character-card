import type { Draft } from "immer";
import type { ApplyOutcome, SystemContext, TimeSpan } from "../../kernel/system";
import {
  type CheckFact,
  checkFact,
  type DamageTier,
  type DiceState,
  isSuccess,
  type Modifier,
} from "../dice";
import { type InventoryState, itemCatalog } from "../inventory";
import {
  ChromeLimbsFactSchema,
  type Condition,
  type DamageCommand,
  type HealCommand,
  type HealthInternal,
  type HealthState,
  LIMB_LABELS,
  type Limb,
  limbSlot,
} from "./schema";

type Health = Draft<HealthState>;

const MINUTES_PER_DAY = 1440;
/** 重伤超过这么多天不处理，开始按天失血 */
export const BLEED_GRACE_DAYS = 2;
const BLEED_PERCENT = 10;
/** 重伤时用治疗品最多回到这个比例 */
const SEVERE_HEAL_CEILING = 29;
const REST_FLOOR = 60;
const REVIVE_PERCENT: Readonly<Partial<Record<Condition, number>>> = { dying: 10, down: 30 };

/** 伤害档位按生命上限的比例换算 */
export const DAMAGE_PERCENT: Readonly<Record<DamageTier, number>> = {
  graze: 10,
  heavy: 30,
  lethal: 60,
};
const DAMAGE_RANK: Readonly<Record<DamageTier, number>> = { graze: 0, heavy: 1, lethal: 2 };
const DAMAGE_TIERS: readonly DamageTier[] = ["graze", "heavy", "lethal"];
export const DAMAGE_LABELS: Readonly<Record<DamageTier, string>> = {
  graze: "擦伤",
  heavy: "重击",
  lethal: "致命",
};
export const CONDITION_LABELS: Readonly<Record<Condition, string>> = {
  up: "正常",
  down: "倒下",
  dying: "濒死",
  dead: "死亡",
};

export type WoundTag = "none" | "light" | "severe" | "zero";

/** 伤势标签由血量自动决定：60% 以上无，30%–59% 轻伤，1%–29% 重伤 */
export function woundTag(state: Pick<HealthState, "hp" | "max">): WoundTag {
  if (state.hp === 0) return "zero";
  if (state.hp * 100 >= state.max * 60) return "none";
  if (state.hp * 100 >= state.max * 30) return "light";
  return "severe";
}

/** 伤势减值，交给检定的 penalties；计入 −4 的减值上限 */
export function woundPenalty(state: Pick<HealthState, "hp" | "max">): Modifier | undefined {
  const tag = woundTag(state);
  if (tag === "light") return { source: "wound", value: 2, reason: "轻伤" };
  if (tag === "severe") return { source: "wound", value: 4, reason: "重伤" };
  return undefined;
}

export function percentOf(max: number, percent: number): number {
  return Math.ceil((max * percent) / 100);
}

const ok = (...notes: string[]): ApplyOutcome => ({ ok: true, notes });
const fail = (reason: string): ApplyOutcome => ({ ok: false, reason });
const hpNote = (draft: Health) => `HP ${draft.hp} / ${draft.max}`;

function trackSevere(draft: Health, now: number): void {
  if (woundTag(draft) === "severe") {
    if (draft.severeSince === null) {
      draft.severeSince = now;
      draft.bleeds = 0;
    }
  } else {
    draft.severeSince = null;
    draft.bleeds = 0;
  }
}

/** 没掷骰不扣血；档位不超过 check 事先说明的（大失败最多高一档）；同一次检定只扣一次；护甲义体再降一档 */
export function applyDamage(
  draft: Health,
  command: DamageCommand,
  ctx: SystemContext,
): ApplyOutcome {
  if (draft.condition !== "up") return fail(`角色${CONDITION_LABELS[draft.condition]}，不能再扣血`);
  const fact = checkFact(ctx.facts);
  if (!fact) return fail("没掷骰不扣血：本轮没有检定结果");
  if (isSuccess(fact.outcome)) return fail("检定成功，不能扣血");
  if (fact.damage === undefined) return fail("check 没有事先写明伤害档位，失败不扣血");
  const cap = Math.min(
    DAMAGE_RANK.lethal,
    DAMAGE_RANK[fact.damage] + (fact.outcome === "fumble" ? 1 : 0),
  );
  if (DAMAGE_RANK[command.tier] > cap) {
    return fail(
      `伤害档位${DAMAGE_LABELS[command.tier]}超过了事先说明的${DAMAGE_LABELS[fact.damage]}（大失败最多高一档）`,
    );
  }
  if (draft.damagedBy === fact.id) return fail("这次检定已经扣过血");
  draft.damagedBy = fact.id;

  // 护甲降一档；几件护甲同时装着也只降一档（turn 只放一件的名字进来）
  const armor = typeof ctx.facts.armor === "string" ? ctx.facts.armor : undefined;
  const rank = DAMAGE_RANK[command.tier] - (armor ? 1 : 0);
  if (rank < 0) {
    return ok(
      `${armor}挡下了这一下（${DAMAGE_LABELS[command.tier]}），没扣血${command.limb ? "，也没断肢" : ""}`,
    );
  }
  const tier = DAMAGE_TIERS[rank] ?? "graze";
  const amount = percentOf(draft.max, DAMAGE_PERCENT[tier]);
  draft.hp = Math.max(0, draft.hp - amount);
  const notes = [
    armor
      ? `${armor}把${DAMAGE_LABELS[command.tier]}降成${DAMAGE_LABELS[tier]} −${amount}，${hpNote(draft)}`
      : `${DAMAGE_LABELS[tier]} −${amount}，${hpNote(draft)}`,
  ];
  if (command.limb) notes.push(loseLimb(draft, command.limb, tier, fact, ctx));
  if (draft.hp === 0) {
    draft.condition = fact.damage === "lethal" ? "dying" : "down";
    notes.push(
      draft.condition === "dying"
        ? "血量归零：濒死，撑到下一段结束"
        : "血量归零：倒下（没有事先警告致命危险，不会死）",
    );
  }
  trackSevere(draft, ctx.now);
  return ok(...notes);
}

/** 断肢：致命档、事先写明、难度允许才断；原本是义肢的部位改记为义体损坏 */
function loseLimb(
  draft: Health,
  limb: Limb,
  tier: DamageTier,
  fact: CheckFact,
  ctx: SystemContext,
): string {
  const label = LIMB_LABELS[limb];
  if (fact.limb !== true) return `没断${label}：check 没有事先写明断肢风险`;
  if (tier !== "lethal") return `没断${label}：降档后不到致命`;
  const mode = ctx.read<DiceState>("dice").mode;
  if (mode === "streetLegend") return `没断${label}：街头传说难度不会断肢`;
  if (fact.damage !== "lethal" && mode !== "deathCity") {
    return `没断${label}：事先写的不是致命档（只有死亡之城大失败升到致命也会断）`;
  }
  const chrome = ChromeLimbsFactSchema.safeParse(ctx.facts.chrome ?? {});
  const part = chrome.success ? chrome.data[limbSlot(limb)] : undefined;
  if (part) {
    if (draft.brokenChrome.includes(part.id)) return `${label}的${part.name}本来就坏着`;
    draft.brokenChrome.push(part.id);
    return `${label}是义肢：${part.name}被打坏了，找义体医生修好前用不了`;
  }
  if (draft.lostLimbs.includes(limb)) return `${label}已经没了`;
  draft.lostLimbs.push(limb);
  return `失去${label}：${limbSlot(limb) === "arms" ? "不能用双手武器" : "不能追车或步行逃跑"}，相关检定 −2；找义体医生装义肢能补上`;
}

/** 义肢和义体损坏：只能由代码发出 */
export function applyLimb(
  draft: Health,
  command: Extract<HealthInternal, { type: "health.limb" }>,
): ApplyOutcome {
  if (command.action === "fit") {
    const fixed = draft.lostLimbs.filter((l) => limbSlot(l) === command.slot);
    if (fixed.length === 0) return ok();
    draft.lostLimbs = draft.lostLimbs.filter((l) => limbSlot(l) !== command.slot);
    return ok(
      `装上${command.name ?? "义肢"}，断了的${fixed.map((l) => LIMB_LABELS[l]).join("、")}补上了`,
    );
  }
  const i = command.id === undefined ? -1 : draft.brokenChrome.indexOf(command.id);
  if (command.action === "clear") {
    if (i >= 0) draft.brokenChrome.splice(i, 1);
    return ok();
  }
  if (i < 0) return fail(`${command.name ?? command.id}没坏`);
  draft.brokenChrome.splice(i, 1);
  return ok(`${command.name ?? command.id}修好了`);
}

export function applyHeal(draft: Health, command: HealCommand, ctx: SystemContext): ApplyOutcome {
  if (draft.condition !== "up") {
    return fail(`角色${CONDITION_LABELS[draft.condition]}，要由别人救治`);
  }
  const severe = woundTag(draft) === "severe";
  switch (command.source) {
    case "maxdoc": {
      const slot = ctx.read<InventoryState>("inventory").healing;
      if (slot === null) return fail("快捷栏没有治疗品");
      if (slot.charges < 1) return fail("治疗品次数用完了，休整或场景结束后恢复");
      const percent = itemCatalog(ctx.data).get(slot.id)?.healPercent;
      if (percent === undefined) return fail(`物品表里的 ${slot.id} 没有回复比例`);
      const ceiling = severe ? Math.floor((draft.max * SEVERE_HEAL_CEILING) / 100) : draft.max;
      draft.hp = Math.max(draft.hp, Math.min(draft.hp + percentOf(draft.max, percent), ceiling));
      trackSevere(draft, ctx.now);
      const notes = [`治疗品回血，${hpNote(draft)}`];
      if (severe) notes.push("重伤时治疗品最多回到 29%，要找义体医生或用药品");
      return { ok: true, notes, emit: [{ type: "inventory.spend", slot: "healing" }] };
    }
    case "ripperdoc":
      draft.hp = draft.max;
      trackSevere(draft, ctx.now);
      return ok(`义体医生处理了伤势，${hpNote(draft)}`);
    case "rest":
      if (severe) return ok("重伤靠休整好不了，要找义体医生或用药品");
      draft.hp = Math.max(draft.hp, percentOf(draft.max, REST_FLOOR));
      trackSevere(draft, ctx.now);
      return ok(`休整后 ${hpNote(draft)}`);
  }
}

export function setMax(draft: Health, max: number, now: number): ApplyOutcome {
  const full = draft.hp === draft.max;
  draft.max = max;
  draft.hp = full ? max : Math.min(draft.hp, max);
  trackSevere(draft, now);
  return ok(`生命上限变为 ${max}，${hpNote(draft)}`);
}

/** 救治：濒死救回到 10%，倒下醒来到 30% */
export function revive(draft: Health, now: number): ApplyOutcome {
  const from = draft.condition;
  const percent = REVIVE_PERCENT[from];
  if (percent === undefined) return fail(`角色${CONDITION_LABELS[from]}，不需要救治`);
  draft.hp = percentOf(draft.max, percent);
  draft.condition = "up";
  trackSevere(draft, now);
  return ok(from === "dying" ? `救回来了，${hpNote(draft)}` : `醒过来了，${hpNote(draft)}`);
}

export function die(draft: Health, reason: string): ApplyOutcome {
  if (draft.condition === "dead") return fail("角色已经死亡");
  draft.condition = "dead";
  draft.hp = 0;
  draft.severeSince = null;
  return ok(`角色死亡：${reason}`);
}

/** 重伤拖过宽限期后每天失血，最多扣到 1，不会因此进入濒死 */
export function bleed(draft: Health, span: TimeSpan): void {
  if (draft.condition !== "up" || draft.severeSince === null) return;
  const days = Math.floor((span.to - draft.severeSince) / MINUTES_PER_DAY);
  const due = Math.max(0, days - BLEED_GRACE_DAYS + 1);
  const step = percentOf(draft.max, BLEED_PERCENT);
  while (draft.bleeds < due) {
    draft.hp = Math.max(1, draft.hp - step);
    draft.bleeds += 1;
  }
}
