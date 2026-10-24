import type { Draft } from "immer";
import type { ApplyOutcome } from "../../kernel/system";
import { ALERT_LABELS, ALERT_MAX, type AlertCommand, type StealthState } from "./schema";

type Stealth = Draft<StealthState>;

/** 当前场景的警戒度；记的是别的场景时按 0 算 */
export function currentAlert(state: StealthState, scene: number): StealthState {
  return state.scene === scene ? state : { scene, level: 0, peak: 0, lowered: false };
}

export function applyAlert(draft: Stealth, command: AlertCommand, scene: number): ApplyOutcome {
  if (draft.scene !== scene) {
    draft.scene = scene;
    draft.level = 0;
    draft.peak = 0;
    draft.lowered = false;
  }
  const from = draft.level;
  if (command.delta < 0) {
    if (from === 0) return { ok: false, reason: "警戒度已经是 0，没得降" };
    if (from >= ALERT_MAX) return { ok: false, reason: "已经交战，只能打或撤，不能再降警戒" };
    if (draft.lowered) return { ok: false, reason: "这个场景已经降过一档警戒" };
    draft.level = from - 1;
    draft.lowered = true;
  } else {
    if (from >= ALERT_MAX) return { ok: false, reason: "已经是交战档" };
    draft.level = Math.min(ALERT_MAX, from + command.delta);
    draft.peak = Math.max(draft.peak, draft.level);
  }
  const notes = [
    `警戒 ${from} → ${draft.level}（${ALERT_LABELS[draft.level]}）：${command.reason}`,
  ];
  if (draft.level === ALERT_MAX && from < ALERT_MAX) {
    notes.push("交战：发 combat start，第一段敌人占优");
  }
  return { ok: true, notes };
}
