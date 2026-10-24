import type { Draft } from "immer";
import type { ApplyOutcome } from "../../kernel/system";
import {
  DAILY_RECOVERY_CAP,
  HUMANITY_MAX,
  type HumanityCommand,
  type HumanityState,
  LOSS_CAP,
  MINUTES_PER_DAY,
  TOLERANCE_FACTOR,
  type Tolerance,
} from "./schema";

export type HumanityStage = "stable" | "detached" | "unstable" | "edge" | "crisis";

export const STAGE_LABELS: Readonly<Record<HumanityStage, string>> = {
  stable: "稳定",
  detached: "疏离",
  unstable: "不稳定",
  edge: "边缘",
  crisis: "危机",
};

/** 人性阶段：注入提示词作为描写的严重程度参考，界面据此切换效果 */
export function humanityStage(value: number): HumanityStage {
  if (value >= 70) return "stable";
  if (value >= 40) return "detached";
  if (value >= 20) return "unstable";
  if (value >= 1) return "edge";
  return "crisis";
}

/** 人性上限 = 100 − 已装义体的人性消耗之和 */
export function humanityCap(state: Pick<HumanityState, "cyberwareCost">): number {
  return HUMANITY_MAX - state.cyberwareCost;
}

export function gameDay(minutes: number): number {
  return Math.floor(minutes / MINUTES_PER_DAY);
}

/** 结算一次人性变化：扣除有单次上限，恢复有每日上限，结果限制在 0 到人性上限之间 */
export function applyHumanity(
  draft: Draft<HumanityState>,
  command: HumanityCommand,
  now: number,
): ApplyOutcome {
  if (command.event !== undefined && draft.settled.includes(command.event)) {
    return { ok: false, reason: `事件 ${command.event} 的人性变化已经结算过` };
  }
  const notes: string[] = [];
  const cap = humanityCap(draft);
  const before = draft.current;
  let delta = command.delta;
  if (delta < -LOSS_CAP) {
    notes.push(`单次人性扣除最多 ${LOSS_CAP}，${delta} 已截断为 −${LOSS_CAP}`);
    delta = -LOSS_CAP;
  }
  if (delta > 0) {
    const day = gameDay(now);
    const used = draft.recovery.day === day ? draft.recovery.amount : 0;
    const room = Math.max(0, DAILY_RECOVERY_CAP - used);
    if (delta > room) {
      notes.push(`今天的人性恢复最多 ${DAILY_RECOVERY_CAP}，+${delta} 只生效 +${room}`);
      delta = room;
    }
    const toCap = Math.max(0, cap - before);
    if (delta > toCap) {
      notes.push(`人性只能恢复到上限 ${cap}`);
      delta = toCap;
    }
    draft.recovery = { day, amount: used + delta };
  }
  if (before + delta < 0) delta = -before;
  draft.current = before + delta;
  if (command.event !== undefined) draft.settled.push(command.event);

  const from = humanityStage(before);
  const to = humanityStage(draft.current);
  if (from !== to) notes.push(`人性阶段：${STAGE_LABELS[from]} → ${STAGE_LABELS[to]}`);
  if (draft.current === 0 && before > 0) notes.push("人性归零，进入危机章节");
  return { ok: true, notes };
}

/** 义体装卸后更新消耗合计（按义体耐受折算）；当前人性超过新上限时降到上限 */
export function setCyberwareCost(draft: Draft<HumanityState>, total: number): ApplyOutcome {
  draft.cyberwareCost = Math.min(
    HUMANITY_MAX,
    Math.round(total * TOLERANCE_FACTOR[draft.tolerance]),
  );
  const cap = humanityCap(draft);
  const notes = [`人性上限变为 ${cap}`];
  if (draft.current > cap) {
    notes.push(`当前人性 ${draft.current} 降到上限 ${cap}`);
    draft.current = cap;
  }
  return { ok: true, notes };
}

const TOLERANCE_LABELS: Readonly<Record<Tolerance, string>> = {
  low: "低耐受",
  normal: "普通",
  high: "高耐受",
};

export function setTolerance(draft: Draft<HumanityState>, tolerance: Tolerance): ApplyOutcome {
  draft.tolerance = tolerance;
  return {
    ok: true,
    notes: [
      `义体耐受：${TOLERANCE_LABELS[tolerance]}，义体的人性消耗 ×${TOLERANCE_FACTOR[tolerance]}`,
    ],
  };
}
