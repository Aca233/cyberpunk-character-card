import type { Draft } from "immer";
import type { ApplyOutcome, Command } from "../../kernel/system";
import { ATTRIBUTE_LABELS, maxHp } from "../dice";
import {
  ATTRIBUTE_MAX,
  type CharacterState,
  LEVELS_PER_POINT,
  type SetCharacter,
  type SpendPoint,
  STREET_CRED_MAX,
} from "./schema";

function setMax(state: Pick<CharacterState, "attributes" | "streetCred">): Command {
  return { type: "health.setMax", max: maxHp(state.attributes.body ?? 3, state.streetCred) };
}

/** 建档：写入角色，声望进度和属性点从零开始 */
export function setCharacter(draft: Draft<CharacterState>, command: SetCharacter): ApplyOutcome {
  draft.name = command.name;
  draft.brief = command.brief;
  draft.attributes = { ...command.attributes };
  draft.streetCred = command.streetCred;
  draft.credHalf = false;
  draft.attributePoints = 0;
  return { ok: true, emit: [setMax(command)] };
}

/** 声望按半级累加，满两个半级升一级；每跨过 5 级得 1 个属性点，升级后生命上限跟着涨 */
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
    return { ok: true, notes: [`街头声望已经是最高的 ${STREET_CRED_MAX} 级`] };
  }
  const total = Math.min(STREET_CRED_MAX * 2, before * 2 + (draft.credHalf ? 1 : 0) + halves);
  draft.streetCred = Math.floor(total / 2);
  draft.credHalf = total % 2 === 1;
  const notes = [`${reason}：街头声望 +${halves / 2} 级`];
  if (draft.streetCred === before) {
    notes.push(`还差半级升到 ${before + 1} 级`);
    return { ok: true, notes };
  }
  notes.push(`街头声望升到 ${draft.streetCred} 级`);
  const points =
    Math.floor(draft.streetCred / LEVELS_PER_POINT) - Math.floor(before / LEVELS_PER_POINT);
  if (points > 0) {
    draft.attributePoints += points;
    notes.push(`得到 ${points} 个属性点，可以在角色栏分配`);
  }
  return { ok: true, notes, emit: [setMax(draft)] };
}

/** 分配一个属性点；单项属性最高 20，加肉体时生命上限跟着涨 */
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
