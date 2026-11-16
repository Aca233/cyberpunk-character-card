import type { Draft } from "immer";
import type { ApplyOutcome } from "../../kernel/system";
import type {
  HumanityCommand,
  HumanityStage,
  HumanityState,
  SuppressHumanity,
  Tolerance,
} from "./schema";

export type { HumanityStage } from "./schema";
export const STAGE_LABELS: Readonly<Record<HumanityStage, string>> = {
  stable: "稳定",
  detached: "疏离",
  unstable: "不稳定",
  edge: "边缘",
  crisis: "临界",
};
const STAGES: readonly HumanityStage[] = ["stable", "detached", "unstable", "edge", "crisis"];
const DISPLAY: Readonly<Record<HumanityStage, number>> = {
  stable: 100,
  detached: 55,
  unstable: 30,
  edge: 10,
  crisis: 0,
};
export function neuralStage(state: Pick<HumanityState, "symptoms">): HumanityStage {
  return state.symptoms.reduce<HumanityStage>(
    (stage, symptom) =>
      STAGES.indexOf(symptom.stage) > STAGES.indexOf(stage) ? symptom.stage : stage,
    "stable",
  );
}
export function neuralDisplay(state: Pick<HumanityState, "symptoms">): number {
  return DISPLAY[neuralStage(state)];
}
/** 给现有 UI 的读出转换，运行规则读取 neuralStage，不读取显示数字。 */
export function humanityStage(value: number): HumanityStage {
  if (value >= 70) return "stable";
  if (value >= 40) return "detached";
  if (value >= 20) return "unstable";
  return value > 0 ? "edge" : "crisis";
}
export function isGlitchZone(value: number, suppressed = false): boolean {
  return !suppressed && value < 40;
}
export function isImmunosuppressed(
  state: Pick<HumanityState, "immunosuppressantUntil">,
  now: number,
): boolean {
  return state.immunosuppressantUntil !== undefined && now < state.immunosuppressantUntil;
}
export function applyHumanity(
  draft: Draft<HumanityState>,
  command: HumanityCommand,
  now: number,
): ApplyOutcome {
  if (command.event && draft.settled.includes(command.event))
    return { ok: false, reason: `事件 ${command.event} 已登记` };
  const i = draft.symptoms.findIndex((s) => s.id === command.id);
  if (command.action === "recover") {
    if (i < 0) return { ok: false, reason: `没有待恢复的症状 ${command.id}` };
    draft.symptoms.splice(i, 1);
  } else {
    if (!command.stage || !command.symptom) return { ok: false, reason: "需要实际症状与定性状态" };
    const symptom = {
      id: command.id,
      stage: command.stage,
      description: command.symptom,
      cause: command.reason,
      at: now,
    };
    if (i < 0) draft.symptoms.push(symptom);
    else draft.symptoms[i] = symptom;
  }
  if (command.event) draft.settled.push(command.event);
  return {
    ok: true,
    signals: ["humanity.changed"],
    notes: [`${command.action === "recover" ? "症状缓解" : "神经状态变化"}：${command.reason}`],
  };
}
export function applySuppressHumanity(
  draft: Draft<HumanityState>,
  command: SuppressHumanity,
  now: number,
): ApplyOutcome {
  draft.immunosuppressantUntil = now + command.durationMinutes;
  return { ok: true, notes: ["压制剂暂时缓解神经症状，诱因与实际损伤仍需处理"] };
}
export function setTolerance(draft: Draft<HumanityState>, tolerance: Tolerance): ApplyOutcome {
  draft.tolerance = tolerance;
  return { ok: true };
}
