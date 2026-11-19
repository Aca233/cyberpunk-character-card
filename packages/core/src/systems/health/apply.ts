import type { Draft } from "immer";
import type { ApplyOutcome, SystemContext, TimeSpan } from "../../kernel/system";
import { type DamageTier, rulingFact } from "../dice";
// biome-ignore lint/style/noRestrictedImports: inventory 入口会反向初始化 NPC 与 health；医疗补给只依赖独立 schema。
import { availableQuickSupply, type InventoryState } from "../inventory/schema";
import {
  BODY_PART_LABELS,
  type BodyPart,
  ChromeLimbsFactSchema,
  type Condition,
  type DamageCommand,
  type HealCommand,
  type HealthInternal,
  type HealthState,
  type Injury,
  LIMB_LABELS,
  type Limb,
  limbSlot,
  type WoundSlot,
} from "./schema";

type Health = Draft<HealthState>;
const DAY = 1440;
export const INJURY_HEAL_MINUTES: Readonly<Record<DamageTier, number>> = {
  graze: DAY,
  heavy: 4 * DAY,
  lethal: 7 * DAY,
};
export const DAMAGE_LABELS: Readonly<Record<DamageTier, string>> = {
  graze: "擦伤",
  heavy: "重创",
  lethal: "致命伤",
};
export const CONDITION_LABELS: Readonly<Record<Condition, string>> = {
  up: "正常",
  down: "倒下",
  dying: "濒死",
  dead: "死亡",
};
export type WoundTag = "none" | "light" | "severe" | "zero";

/** 展示阶段由实际创口和失能事实决定；它不参与伤害结算。 */
export function woundSlotOf(
  state: Pick<HealthState, "condition" | "injuries" | "lostLimbs">,
): WoundSlot {
  if (state.condition !== "up") return 4;
  if (state.lostLimbs.length || state.injuries.some((i) => i.tier === "lethal")) return 3;
  if (state.injuries.some((i) => i.tier === "heavy")) return 2;
  return state.injuries.length ? 1 : 0;
}
export function woundTag(
  state: Pick<HealthState, "condition" | "injuries" | "lostLimbs">,
): WoundTag {
  const slot = woundSlotOf(state);
  return slot === 4 ? "zero" : slot === 3 ? "severe" : slot === 2 ? "light" : "none";
}
/** 固定界面的健康指示条，仅作读出，绝不反向决定人物状态。 */
export function healthDisplay(state: Pick<HealthState, "condition" | "injuries" | "lostLimbs">) {
  const marks = [100, 90, 50, 20, 0] as const;
  return { hp: marks[woundSlotOf(state)], max: 100 };
}
const ok = (...notes: string[]): ApplyOutcome => ({ ok: true, notes });
const fail = (reason: string): ApplyOutcome => ({ ok: false, reason });

function recordInjury(
  draft: Health,
  entry: {
    part: BodyPart | null;
    tier: DamageTier;
    cause: string;
    now: number;
    source?: "injury" | "combat";
    id?: string;
  },
): Injury {
  const id = entry.id ?? `injury-${draft.nextInjuryId++}`;
  const injury: Injury = {
    id,
    part: entry.part,
    tier: entry.tier,
    cause: entry.cause,
    at: entry.now,
    healsAt: entry.tier === "graze" ? entry.now + DAY : null,
    treated: false,
    source: entry.source ?? "injury",
  };
  draft.injuries.push(injury);
  if (entry.tier === "lethal") draft.condition = "dying";
  return injury;
}

/** 伤害严重度已经过现场裁决；不再按护甲统一降档，也不扣抽象生命值。 */
export function applyDamage(
  draft: Health,
  command: DamageCommand,
  ctx: SystemContext,
): ApplyOutcome {
  if (draft.condition === "dead") return fail("角色已经死亡");
  const ruling = rulingFact(ctx.facts);
  if (ruling) {
    if (ruling.harm === "none") return fail("现场裁决未确认受伤，不能登记伤势");
    if (draft.damagedBy === ruling.id) return fail("这一轮已经登记过伤害");
    const rank = { graze: 0, heavy: 1, lethal: 2 };
    if (rank[command.tier] > rank[ruling.harm]) return fail("伤势超出现场裁决确认的范围");
  }
  if (command.limb && (command.tier !== "lethal" || ruling?.limb !== true)) {
    return fail("断肢需要裁决已确认的直接断肢危险和致命损伤");
  }
  const part = command.part ?? command.limb ?? null;
  recordInjury(draft, { part, tier: command.tier, cause: command.reason, now: ctx.now });
  if (ruling) draft.damagedBy = ruling.id;
  const notes = [
    `${part ? BODY_PART_LABELS[part] : "身体"}${DAMAGE_LABELS[command.tier]}：${command.reason}`,
  ];
  if (command.limb) notes.push(loseLimb(draft, command.limb, ctx));
  return ok(...notes);
}
function loseLimb(draft: Health, limb: Limb, ctx: SystemContext): string {
  const chrome = ChromeLimbsFactSchema.safeParse(ctx.facts.chrome ?? {});
  const part = chrome.success ? chrome.data[limbSlot(limb)] : undefined;
  if (part) {
    if (!draft.brokenChrome.includes(part.id)) draft.brokenChrome.push(part.id);
    return `${LIMB_LABELS[limb]}的${part.name}损坏，修复前失去对应能力`;
  }
  if (!draft.lostLimbs.includes(limb)) draft.lostLimbs.push(limb);
  return `失去${LIMB_LABELS[limb]}，对应抓握、支撑或移动能力受限，需救治并安装义肢`;
}
export function applyLimb(
  draft: Health,
  command: Extract<HealthInternal, { type: "health.limb" }>,
): ApplyOutcome {
  if (command.action === "fit") {
    const fixed = draft.lostLimbs.filter((l) => limbSlot(l) === command.slot);
    draft.lostLimbs = draft.lostLimbs.filter((l) => limbSlot(l) !== command.slot);
    return ok(
      ...(fixed.length
        ? [`装上${command.name ?? "义肢"}，补上${fixed.map((l) => LIMB_LABELS[l]).join("、")}`]
        : []),
    );
  }
  const i = command.id === undefined ? -1 : draft.brokenChrome.indexOf(command.id);
  if (i < 0 && command.action === "repair") return fail(`${command.name ?? command.id}没坏`);
  if (i >= 0) draft.brokenChrome.splice(i, 1);
  return ok(...(command.action === "repair" ? [`${command.name ?? command.id}修好了`] : []));
}
export function applyHit(
  draft: Health,
  command: Extract<HealthInternal, { type: "health.hit" }>,
  ctx: SystemContext,
): ApplyOutcome {
  if (draft.condition === "dead") return fail("角色已经死亡");
  if (command.injuryId && draft.injuries.some((i) => i.id === command.injuryId))
    return fail("这处伤已经登记");
  recordInjury(draft, {
    part: command.part ?? null,
    tier: command.tier,
    cause: command.reason,
    now: ctx.now,
    source: "combat",
    ...(command.injuryId ? { id: command.injuryId } : {}),
  });
  return ok(
    `${command.part ? BODY_PART_LABELS[command.part] : "身体"}${DAMAGE_LABELS[command.tier]}：${command.reason}`,
  );
}
export function treatInjury(draft: Health, id: string, now: number): ApplyOutcome {
  const injury = draft.injuries.find((i) => i.id === id);
  if (!injury) return fail(`找不到伤处 ${id}`);
  injury.treated = true;
  injury.healsAt ??= now + INJURY_HEAL_MINUTES[injury.tier];
  if (draft.condition === "dying" && !draft.injuries.some((i) => i.tier === "lethal" && !i.treated))
    draft.condition = "up";
  return ok(`已处理${injury.part ? BODY_PART_LABELS[injury.part] : "伤口"}，创口仍需恢复`);
}
export function applyHeal(draft: Health, command: HealCommand, ctx: SystemContext): ApplyOutcome {
  if (draft.condition === "dead") return fail("角色已经死亡");
  if (command.source === "maxdoc") {
    if (draft.condition !== "up") return fail("角色无法自行用药，需要现场救援");
    if (!draft.injuries.length || draft.painSuppressed) return fail("当前没有需要再次镇痛的伤势");
    const inventory = ctx.read<InventoryState>("inventory");
    if (!availableQuickSupply(inventory, "healing")) return fail("没有可用医疗针，需要实际补给");
    draft.painSuppressed = true;
    draft.painSuppressedUntil = ctx.now + 120;
    return {
      ok: true,
      notes: ["医疗针暂时缓解疼痛，创口和损坏仍存在"],
      emit: [{ type: "inventory.spend", slot: "healing" }],
    };
  }
  if (command.source === "ripperdoc") {
    for (const injury of draft.injuries) treatInjury(draft, injury.id, ctx.now);
    if (draft.condition === "down") draft.condition = "up";
    return ok("医生完成清创和稳定处理，伤口进入恢复期；断肢和损坏义体仍需专门处理");
  }
  return ok("休整为恢复提供条件；现存伤口按恢复时间愈合，重伤仍需救治");
}
export function revive(draft: Health, now: number): ApplyOutcome {
  if (draft.condition !== "dying" && draft.condition !== "down")
    return fail(`角色${CONDITION_LABELS[draft.condition]}，不需要救治`);
  for (const injury of draft.injuries)
    if (injury.tier === "lethal") treatInjury(draft, injury.id, now);
  draft.condition = "up";
  return ok("救援稳定了生命体征，具体伤势仍在恢复中");
}
export function die(draft: Health, reason: string): ApplyOutcome {
  if (draft.condition === "dead") return fail("角色已经死亡");
  draft.condition = "dead";
  return ok(`角色死亡：${reason}`);
}
/** 只有浅伤或已治疗且到了恢复时间的伤口会愈合；不按日扣血或切场洗伤。 */
export function recoverInjuries(draft: Health, span: TimeSpan): void {
  if (draft.condition === "dead") return;
  draft.injuries = draft.injuries.filter((i) => i.healsAt === null || span.to < i.healsAt);
  if (draft.painSuppressedUntil !== null && span.to >= draft.painSuppressedUntil) {
    draft.painSuppressed = false;
    draft.painSuppressedUntil = null;
  }
}
