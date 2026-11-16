import type { Draft } from "immer";
import type { ApplyOutcome, SystemContext, TimeSpan } from "../../kernel/system";
import {
  type Attribute,
  type CheckFact,
  checkFact,
  type DamageTier,
  type DiceState,
  isCleanSuccess,
  type Modifier,
  type RulingFact,
  rulingFact,
} from "../dice";
import { type InventoryState, itemCatalog } from "../inventory";
import {
  BODY_PART_LABELS,
  type BodyPart,
  ChromeLimbsFactSchema,
  type Condition,
  type DamageCommand,
  type DeathLineChannel,
  type HealCommand,
  type HealthInternal,
  type HealthState,
  type Injury,
  LIMB_LABELS,
  type Limb,
  limbSlot,
  WOUND_SLOT_LABELS,
  type WoundSlot,
} from "./schema";

type Health = Draft<HealthState>;

const MINUTES_PER_DAY = 1440;
const INJURY_HEAL_MINUTES: Readonly<Record<DamageTier, number>> = {
  graze: MINUTES_PER_DAY,
  heavy: 4 * MINUTES_PER_DAY,
  lethal: 7 * MINUTES_PER_DAY,
};
/** 重伤超过这么多天不处理，开始按天恶化 */
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

/**
 * 3.0 四格具象伤势映射（0 完好 / 1 挂彩 / 2 重创 / 3 残废 / 4 生死线）：
 * - 0 格（完好）：无伤且满状态
 * - 1 格（挂彩）：轻擦伤（60% ~ 99%），无检定惩罚，休整 1 相位即消
 * - 2 格（重创）：30% ~ 59%，肉体/反应检定 -2（可打医疗针临时压制 1 场，或由【情感解离】免疫）
 * - 3 格（残废）：1% ~ 29% 或伴随断肢，全检定 -4
 * - 4 格（生死线）：0%（濒死/倒下/死亡），触发三大保底通道
 */
export function woundSlotOf(
  state: Pick<HealthState, "hp" | "max"> & {
    readonly wounds?: number;
    readonly lostLimbs?: readonly Limb[];
  },
): WoundSlot {
  if (state.hp <= 0) return 4;
  if ((state.lostLimbs?.length ?? 0) > 0 || state.hp * 100 < state.max * 30) return 3;
  if (state.hp * 100 < state.max * 60) return 2;
  if (state.hp < state.max) return 1;
  return 0;
}

/** 伤势标签由血量自动决定：60% 以上无，30%–59% 轻伤（对应 3.0 重创 2 格），1%–29% 重伤（对应 3.0 残废 3 格） */
export function woundTag(state: Pick<HealthState, "hp" | "max">): WoundTag {
  if (state.hp === 0) return "zero";
  if (state.hp * 100 >= state.max * 60) return "none";
  if (state.hp * 100 >= state.max * 30) return "light";
  return "severe";
}

/**
 * 3.0 伤势减值计算：
 * - 0 格（完好）/ 1 格（轻伤挂彩）：无检定惩罚
 * - 2 格（贯通重创）：肉体/反应检定 -2（若打了医疗针/止痛剂临时压制则免除）
 * - 3 格（失能重残）：全检定 -4
 */
export function woundPenalty(
  state: Pick<HealthState, "hp" | "max"> & {
    readonly painSuppressed?: boolean;
    readonly lostLimbs?: readonly Limb[];
  },
  attribute?: Attribute,
): Modifier | undefined {
  const slot = woundSlotOf(state);
  if (slot === 3 || slot === 4) {
    return { source: "wound", value: 4, reason: "失能重残（3 级伤势：全检定 -4）" };
  }
  if (slot === 2) {
    if (state.painSuppressed) return undefined;
    if (attribute !== undefined && attribute !== "body" && attribute !== "reflexes") {
      return undefined;
    }
    return { source: "wound", value: 2, reason: "贯通重创（2 级伤势：肉体/反应 -2）" };
  }
  return undefined;
}

/**
 * 3.0 第 4 级【濒死休克】真实抢救通道判定：
 * ① 创伤小组白金卡（hasPlatinumTrauma 且未处于地下信号屏蔽区/禁飞区 !inSignalDeadZone）
 * ② 副心脏义体（hasSecondHeart）或在场队友/高信任熟人拖离（hasAllyRescue）
 * ③ 街头横死（mode === "deathCity" 且无卡无友 -> 正式死亡）
 */
export function resolveDeathLineChannel(options: {
  readonly hasPlatinumTrauma?: boolean;
  readonly inSignalDeadZone?: boolean;
  readonly hasSecondHeart?: boolean;
  readonly hasAllyRescue?: boolean;
  readonly mode: DiceState["mode"];
}): {
  readonly channel: DeathLineChannel;
  readonly targetWoundSlot: WoundSlot;
  readonly eddyCost: number;
  readonly bloodDebt: boolean;
  readonly summary: string;
} {
  if (options.hasPlatinumTrauma && !options.inSignalDeadZone) {
    return {
      channel: "traumaPlatinum",
      targetWoundSlot: 1,
      eddyCost: 5000,
      bloodDebt: false,
      summary: "创伤小组白金卡信号激活：武装浮空车数分钟内降落清场急救，扣除 5,000€ 医疗费",
    };
  }
  if (options.hasSecondHeart) {
    return {
      channel: "secondHeartOrAlly",
      targetWoundSlot: 2,
      eddyCost: 0,
      bloodDebt: false,
      summary: "体内【副心脏】义体自动高压电击起搏，从濒死休克强行拉回重创状态",
    };
  }
  if (options.hasAllyRescue || options.mode !== "deathCity") {
    return {
      channel: "secondHeartOrAlly",
      targetWoundSlot: 2,
      eddyCost: 300,
      bloodDebt: true,
      summary: "同伴/熟人将昏迷的你拖出火线送往就近黑诊所抢救，拉回重创状态并欠下人情与手术债",
    };
  }
  return {
    channel: "deathCityCurtain",
    targetWoundSlot: 4,
    eddyCost: 0,
    bloodDebt: false,
    summary: "无创伤信号接应、无副心脏、无同伴救援，在夜之城冰冷的街头失血谢幕",
  };
}

export function percentOf(max: number, percent: number): number {
  return Math.ceil((max * percent) / 100);
}

const ok = (...notes: string[]): ApplyOutcome => ({ ok: true, notes });
const fail = (reason: string): ApplyOutcome => ({ ok: false, reason });

function syncWounds(draft: Health): void {
  draft.wounds = woundSlotOf(draft);
}

const hpNote = (draft: Health) => {
  syncWounds(draft);
  return `${WOUND_SLOT_LABELS[draft.wounds]}（HP ${draft.hp} / ${draft.max}）`;
};

function ensureInjuries(draft: Health): Injury[] {
  draft.injuries ??= [];
  return draft.injuries;
}

function recordInjury(
  draft: Health,
  entry: {
    readonly part: BodyPart | null;
    readonly tier: DamageTier;
    readonly cause: string;
    readonly now: number;
  },
): Injury {
  const list = ensureInjuries(draft);
  const nextNum =
    list.reduce(
      (max, item) => Math.max(max, Number.parseInt(item.id.replace(/\D+/g, ""), 10) || 0),
      0,
    ) + 1;
  const created: Injury = {
    id: `i${nextNum}`,
    part: entry.part,
    tier: entry.tier,
    cause: entry.cause,
    at: entry.now,
    healsAt: entry.now + INJURY_HEAL_MINUTES[entry.tier],
    treated: false,
  };
  list.push(created);
  return created;
}

function pruneGrazeInjuries(draft: Health): void {
  if (!draft.injuries || draft.injuries.length === 0) return;
  draft.injuries = draft.injuries.filter((inj) => inj.tier !== "graze");
}

function trackSevere(draft: Health, now: number): void {
  syncWounds(draft);
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

/** 零掷骰模式下按定性裁决或直接伤口档位扣血（同轮不重复结算）；保留兼容旧检定回放；护甲义体再降一档 */
export function applyDamage(
  draft: Health,
  command: DamageCommand,
  ctx: SystemContext,
): ApplyOutcome {
  if (draft.condition !== "up") return fail(`角色${CONDITION_LABELS[draft.condition]}，不能再扣血`);
  const fact = checkFact(ctx.facts);
  let declaredLethal = false;
  let limbRule: { readonly fact?: CheckFact; readonly ruling?: RulingFact } = {};

  if (fact) {
    if (isCleanSuccess(fact.outcome)) return fail("检定干净利落成功，不能扣血");
    if (fact.damage === undefined && fact.outcome !== "costly") {
      return fail("check 没有事先写明伤害档位，失败不扣血");
    }
    const declaredDamage = fact.damage ?? "graze";
    const cap = Math.min(
      DAMAGE_RANK.lethal,
      DAMAGE_RANK[declaredDamage] + (fact.outcome === "fumble" ? 1 : 0),
    );
    if (DAMAGE_RANK[command.tier] > cap) {
      return fail(
        `伤害档位${DAMAGE_LABELS[command.tier]}超过了事先说明的${DAMAGE_LABELS[declaredDamage]}（大失败最多高一档）`,
      );
    }
    if (draft.damagedBy === fact.id) return fail("这次检定已经扣过血");
    draft.damagedBy = fact.id;
    declaredLethal = declaredDamage === "lethal";
    limbRule = { fact };
  } else {
    const ruling = rulingFact(ctx.facts);
    if (ruling) {
      if (draft.damagedBy === ruling.id) return fail("这一轮已经结算过伤害");
      if (command.tier === "lethal" && ruling.harm !== "lethal") {
        return fail("现场判断不属于致命绝境，这一击最重记 heavy");
      }
      draft.damagedBy = ruling.id;
      declaredLethal = ruling.harm === "lethal";
      limbRule = { ruling };
    } else if (command.tier === "lethal") {
      declaredLethal = true;
    }
  }

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
  const part = command.part ?? command.limb ?? null;
  recordInjury(draft, { part, tier, cause: command.reason, now: ctx.now });
  const partTag = part ? `${BODY_PART_LABELS[part]}·` : "";
  const notes = [
    armor
      ? `${armor}把${DAMAGE_LABELS[command.tier]}降成${partTag}${DAMAGE_LABELS[tier]} −${amount}，${hpNote(draft)}`
      : `${partTag}${DAMAGE_LABELS[tier]} −${amount}，${hpNote(draft)}`,
  ];
  if (command.limb) notes.push(loseLimb(draft, command.limb, tier, limbRule, ctx));
  if (draft.hp === 0) {
    draft.condition = declaredLethal ? "dying" : "down";
    notes.push(
      draft.condition === "dying"
        ? "跌入【生死线】：濒死，需创伤白金卡、副心脏或熟人拖离"
        : "跌入【生死线】：倒下（未定性为致命绝境，不会当场死）",
    );
  }
  trackSevere(draft, ctx.now);
  return ok(...notes);
}

/** 断肢：致命档、事先裁决存在断肢危险、难度允许才断；原本是义肢的部位改记为义体损坏 */
function loseLimb(
  draft: Health,
  limb: Limb,
  tier: DamageTier,
  rule: { readonly fact?: CheckFact | undefined; readonly ruling?: RulingFact | undefined },
  ctx: SystemContext,
): string {
  const label = LIMB_LABELS[limb];
  const limbAllowed = rule.fact ? rule.fact.limb === true : rule.ruling?.limb === true;
  if (!limbAllowed) return `没断${label}：当前场面没有认定存在直接断肢危险`;
  if (tier !== "lethal") return `没断${label}：降档后不到致命`;
  const mode = ctx.read<DiceState>("dice").mode;
  if (mode === "streetLegend") return `没断${label}：街头传说难度不会断肢`;
  if (rule.fact && rule.fact.damage !== "lethal" && mode !== "deathCity") {
    return `没断${label}：事先写的不是致命档（只有死亡之城大失败升到致命也会断）`;
  }
  const chrome = ChromeLimbsFactSchema.safeParse(ctx.facts.chrome ?? {});
  const part = chrome.success ? chrome.data[limbSlot(limb)] : undefined;
  if (part) {
    if (draft.brokenChrome.includes(part.id)) return `${label}的${part.name}本来就坏着`;
    draft.brokenChrome.push(part.id);
    syncWounds(draft);
    return `${label}是义肢：${part.name}被打坏了，找义体医生修好前用不了`;
  }
  if (draft.lostLimbs.includes(limb)) return `${label}已经没了`;
  draft.lostLimbs.push(limb);
  syncWounds(draft);
  return `失去${label}（进入重残状态）：${limbSlot(limb) === "arms" ? "不能用双手武器" : "不能追车或步行逃跑"}，全检定 −4；找义体医生装义肢能补上`;
}

/** 义肢与义体损坏修复：只能由代码发出 */
export function applyLimb(
  draft: Health,
  command: Extract<HealthInternal, { type: "health.limb" }>,
): ApplyOutcome {
  if (command.action === "fit") {
    const fixed = draft.lostLimbs.filter((l) => limbSlot(l) === command.slot);
    if (fixed.length === 0) return ok();
    draft.lostLimbs = draft.lostLimbs.filter((l) => limbSlot(l) !== command.slot);
    syncWounds(draft);
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

/** 扣一档的血：护甲降一档；归零时致命档濒死，其余倒下 */
function wound(draft: Health, tier: DamageTier, ctx: SystemContext, notes: string[]): void {
  const armor = typeof ctx.facts.armor === "string" ? ctx.facts.armor : undefined;
  const rank = DAMAGE_RANK[tier] - (armor ? 1 : 0);
  if (rank < 0) {
    notes.push(`${armor}挡下了这一下`);
    return;
  }
  const real = DAMAGE_TIERS[rank] ?? "graze";
  const amount = percentOf(draft.max, DAMAGE_PERCENT[real]);
  draft.hp = Math.max(0, draft.hp - amount);
  notes.push(`${DAMAGE_LABELS[real]} −${amount}，${hpNote(draft)}`);
  if (draft.hp === 0) {
    draft.condition = tier === "lethal" ? "dying" : "down";
    notes.push(
      draft.condition === "dying"
        ? "跌入【生死线】：濒死，这一轮结束前要被救回"
        : "跌入【生死线】：倒下",
    );
  }
  trackSevere(draft, ctx.now);
}

/** 战斗登记伤口时按档位扣血，护甲照常减伤 */
export function applyHit(
  draft: Health,
  command: Extract<HealthInternal, { type: "health.hit" }>,
  ctx: SystemContext,
): ApplyOutcome {
  if (draft.condition !== "up") return fail(`角色${CONDITION_LABELS[draft.condition]}，不能再挨打`);
  const notes: string[] = [command.reason];
  wound(draft, command.tier, ctx, notes);
  return ok(...notes);
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
      draft.painSuppressed = true;
      if (draft.hp === draft.max) pruneGrazeInjuries(draft);
      trackSevere(draft, ctx.now);
      const notes = [`使用医疗针，临时压制本场重创疼痛，${hpNote(draft)}`];
      if (severe) notes.push("残废/重伤时医疗针最多回到 29%，需找义体医生缝合");
      return { ok: true, notes, emit: [{ type: "inventory.spend", slot: "healing" }] };
    }
    case "ripperdoc":
      draft.hp = draft.max;
      draft.painSuppressed = false;
      draft.injuries = [];
      trackSevere(draft, ctx.now);
      return ok(`义体医生缝合处理了伤势，${hpNote(draft)}`);
    case "rest":
      if (severe) return ok("重伤靠休整好不了，要找义体医生或用药品");
      draft.hp = Math.max(draft.hp, percentOf(draft.max, REST_FLOOR));
      if (draft.wounds === 1) {
        draft.hp = draft.max;
      }
      pruneGrazeInjuries(draft);
      draft.painSuppressed = false;
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
  draft.wounds = 4;
  draft.severeSince = null;
  return ok(`角色死亡：${reason}`);
}

/** 随时间推移：到期的具体浅伤自然长好；重伤拖过宽限期后恶化失血，最多扣到 1 */
export function bleed(draft: Health, span: TimeSpan): void {
  if (draft.condition !== "dead" && draft.injuries && draft.injuries.length > 0) {
    draft.injuries = draft.injuries.filter((inj) => inj.healsAt === null || span.to < inj.healsAt);
  }
  if (draft.condition !== "up" || draft.severeSince === null) return;
  const days = Math.floor((span.to - draft.severeSince) / MINUTES_PER_DAY);
  const due = Math.max(0, days - BLEED_GRACE_DAYS + 1);
  const step = percentOf(draft.max, BLEED_PERCENT);
  while (draft.bleeds < due) {
    draft.hp = Math.max(1, draft.hp - step);
    draft.bleeds += 1;
  }
  syncWounds(draft);
}
