import type { Draft } from "immer";
import type { ApplyOutcome, Command } from "../../kernel/system";
import { ATTRIBUTE_LABELS, maxHp } from "../dice";
import {
  ATTRIBUTE_MAX,
  type CharacterState,
  effectiveAttribute,
  type SetBonuses,
  type SetCharacter,
  type SpendPoint,
  STREET_CRED_MAX,
} from "./schema";

/** 传奇之路：声望到达里程碑时世界的反应；叙事模型据此写路人、帮派和中间人的态度 */
export const CRED_TIERS = [
  { from: 0, label: "无名小卒", world: "没人认识你，中间人只给小活，混混不把你放在眼里" },
  { from: 10, label: "小有名气", world: "常去的酒吧有人叫得出你的名字，街头混混动手前会掂量一下" },
  {
    from: 20,
    label: "道上有名",
    world: "中间人主动找上门，帮派里有人听过你的事，也有人想拿你立威",
  },
  { from: 35, label: "响当当", world: "陌生人认得出你，混混见了你就躲，公司的人开始留意你" },
  {
    from: 50,
    label: "传奇",
    world: "你是夜之城的传说：来生酒吧有以你命名的调酒，人人都想和你扯上关系",
  },
] as const;
export type CredTier = (typeof CRED_TIERS)[number];

export function credTier(level: number): CredTier {
  return CRED_TIERS.findLast((t) => level >= t.from) ?? CRED_TIERS[0];
}

function setMax(
  state: Pick<CharacterState, "attributes" | "streetCred"> & {
    readonly bonuses?: CharacterState["bonuses"];
  },
): Command {
  return { type: "health.setMax", max: maxHp(effectiveAttribute(state, "body"), state.streetCred) };
}

/** 建档：写入角色，声望进度和属性点从零开始 */
export function setCharacter(draft: Draft<CharacterState>, command: SetCharacter): ApplyOutcome {
  draft.name = command.name;
  draft.brief = command.brief;
  draft.attributes = { ...command.attributes };
  draft.streetCred = command.streetCred;
  draft.credHalf = false;
  draft.attributePoints = 0;
  draft.traits = (command.traits ?? []).map((t) => ({ ...t }));
  draft.flashbackUsed = [];
  draft.flashback = null;
  draft.pastFacts = [];
  return { ok: true, emit: [setMax(draft)] };
}

/** 义体装卸同步兼容状态快照（不再输出 RPG 属性加减提示） */
export function setBonuses(draft: Draft<CharacterState>, command: SetBonuses): ApplyOutcome {
  const bodyChanged = (draft.bonuses.body ?? 0) !== (command.bonuses.body ?? 0);
  draft.bonuses = Object.fromEntries(
    Object.entries(command.bonuses).filter(([, n]) => n !== undefined && n > 0),
  );
  return { ok: true, ...(bodyChanged ? { emit: [setMax(draft)] } : {}) };
}

/** 声望按半级累加，只更新街头名声里程碑，不再发放 RPG 属性升级点 */
export function gainCred(
  draft: Draft<CharacterState>,
  halves: number,
  reason: string,
  event: string,
): ApplyOutcome {
  if (draft.credSettled.includes(event)) {
    return { ok: false, reason: `事件 ${event} 的街头声望已经结算过` };
  }
  draft.credSettled.push(event);
  const before = draft.streetCred;
  if (before >= STREET_CRED_MAX) {
    return { ok: true, notes: [`${reason}：在夜之城的名头已经传到顶了`] };
  }
  const total = Math.min(STREET_CRED_MAX * 2, before * 2 + (draft.credHalf ? 1 : 0) + halves);
  draft.streetCred = Math.floor(total / 2);
  draft.credHalf = total % 2 === 1;
  const notes: string[] = [];
  if (draft.streetCred === before) {
    notes.push(`${reason}：街面上多了些你的风声`);
    return { ok: true, notes };
  }
  const tier = credTier(draft.streetCred);
  if (tier !== credTier(before)) notes.push(`名声变化「${tier.label}」：${tier.world}`);
  else notes.push(`${reason}：名声又传开了一些`);
  return { ok: true, notes, emit: [setMax(draft)] };
}

/** 分配一个属性点；单项属性最高 10，加肉体时生命上限跟着涨 */
export function spendPoint(draft: Draft<CharacterState>, command: SpendPoint): ApplyOutcome {
  if (draft.attributePoints <= 0) return { ok: false, reason: "没有可分配的属性点" };
  const label = ATTRIBUTE_LABELS[command.attribute];
  const value = draft.attributes[command.attribute] ?? 0;
  if (value >= ATTRIBUTE_MAX) {
    return { ok: false, reason: `${label}已经是最高的 ${ATTRIBUTE_MAX}` };
  }
  draft.attributes[command.attribute] = value + 1;
  draft.attributePoints -= 1;
  return {
    ok: true,
    notes: [`${label}升到 ${value + 1}`],
    ...(command.attribute === "body" ? { emit: [setMax(draft)] } : {}),
  };
}
