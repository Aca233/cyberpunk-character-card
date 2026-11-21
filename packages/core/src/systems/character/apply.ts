import type { Draft } from "immer";
import type { ApplyOutcome } from "../../kernel/system";
import { type CharacterState, type SetCharacter, STREET_CRED_MAX } from "./schema";

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
    world:
      "你的事迹已传遍夜之城，来生的佣兵和中间人把你当作传奇，也有人想借你的名声获利；是否有以你命名的调酒，须由实际发生的纪念事件决定",
  },
] as const;
export type CredTier = (typeof CRED_TIERS)[number];

export function credTier(level: number): CredTier {
  return CRED_TIERS.findLast((t) => level >= t.from) ?? CRED_TIERS[0];
}

/** 把声望门槛换算成不带数字和「级」字的定性条件 */
export function credGateLabel(threshold: number): string {
  if (threshold >= 50) return "在夜之城成为「传奇」";
  if (threshold >= 35) return "街头名声达到「响当当」";
  if (threshold >= 20) return "街头名声达到「道上有名」";
  if (threshold >= 10) return "街头名声达到「小有名气」";
  return "在街上先混出点风声";
}

/** 建档：写入角色，声望进度从零开始 */
export function setCharacter(draft: Draft<CharacterState>, command: SetCharacter): ApplyOutcome {
  draft.name = command.name;
  draft.brief = command.brief;
  if (command.visual !== undefined) draft.visual = { ...command.visual };
  else delete draft.visual;
  draft.streetCred = command.streetCred;
  draft.credHalf = false;
  draft.traits = (command.traits ?? []).map((t) => ({ ...t }));
  draft.flashbackUsed = [];
  draft.flashback = null;
  draft.pastFacts = [];
  if (command.portrait) draft.portrait = command.portrait;
  else delete draft.portrait;
  return { ok: true };
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
  return { ok: true, notes };
}
