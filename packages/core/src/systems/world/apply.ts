import type { Draft } from "immer";
import type { ApplyOutcome } from "../../kernel/system";
import { createPlace, markVisit, resolveLocation } from "./places";
import {
  type Deadline,
  type DeadlineCommand,
  PHASE_LABELS,
  type PhaseClock,
  type PhaseIndex,
  type WorldClockState,
  type WorldCommand,
} from "./schema";

const MINUTES_PER_DAY = 1440;
/** 1 个相位标准时长：6 小时 = 360 分钟 */
export const MINUTES_PER_PHASE = 360;
/** 连续多少个相位不睡觉触发【疲劳（全属性 -1）】 */
export const FATIGUE_PHASE_THRESHOLD = 4;

export type Period = "dawn" | "day" | "dusk" | "night";

export const PERIOD_LABELS: Readonly<Record<Period, string>> = {
  dawn: "清晨",
  day: "白天",
  dusk: "傍晚",
  night: "深夜",
};

const PERIOD_STARTS: readonly (readonly [number, Period])[] = [
  [5, "dawn"],
  [9, "day"],
  [17, "dusk"],
  [21, "night"],
];

function minuteOfDay(minutes: number): number {
  return ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

export function formatGameTime(minutes: number): string {
  return new Date(minutes * 60000).toISOString().slice(0, 16).replace("T", " ");
}

export function periodOf(minutes: number): Period {
  const hour = Math.floor(minuteOfDay(minutes) / 60);
  let period: Period = "night";
  for (const [start, p] of PERIOD_STARTS) if (hour >= start) period = p;
  return period;
}

/**
 * 3.0 四段相位换算：
 * - 0 ☀️昼 (day)
 * - 1 🌆昏 (dusk)
 * - 2 🌙夜 (night)
 * - 3 🌫️晓 (dawn)
 */
export function phaseIndexOf(minutes: number): PhaseIndex {
  const p = periodOf(minutes);
  if (p === "day") return 0;
  if (p === "dusk") return 1;
  if (p === "night") return 2;
  return 3;
}

export function phaseClockOf(
  minutes: number,
  startTime = 0,
): PhaseClock & { readonly label: string } {
  const elapsedDays = Math.max(0, Math.floor((minutes - startTime) / MINUTES_PER_DAY));
  const phase = phaseIndexOf(minutes);
  return {
    day: elapsedDays + 1,
    phase,
    label: `第 ${elapsedDays + 1} 天 · ${PHASE_LABELS[phase]}`,
  };
}

/** 是否处于疲劳状态（连续 4 相位未睡，全属性 -1） */
export function isFatigued(state: Pick<WorldClockState, "phasesAwake">): boolean {
  return (state.phasesAwake ?? 0) >= FATIGUE_PHASE_THRESHOLD;
}

/** 是否染上黑蕾丝毒瘾（7 天内服用 ≥ 3 次）且当前处于停药戒断期（反应 -1，镇定 -2） */
export function isBlackLaceWithdrawal(
  state: Pick<WorldClockState, "blackLaceDoses" | "blackLaceActiveUntil">,
  now: number,
): boolean {
  const windowStart = now - 7 * MINUTES_PER_DAY;
  const recent = (state.blackLaceDoses ?? []).filter((t) => t >= windowStart);
  if (recent.length < 3) return false;
  return state.blackLaceActiveUntil === null || state.blackLaceActiveUntil <= now;
}

/** 已经到期、还没回应的事件；一次跳过好几天时全部列出 */
export function dueDeadlines(state: WorldClockState, now: number): readonly Deadline[] {
  return state.deadlines
    .filter((d) => d.handledAt === null && d.due <= now)
    .sort((a, b) => a.due - b.due);
}

const fail = (reason: string): ApplyOutcome => ({ ok: false, reason });

function dueNotes(draft: Draft<WorldClockState>, from: number, to: number): string[] {
  return draft.deadlines
    .filter((d) => d.handledAt === null && d.due > from && d.due <= to)
    .map((d) => `到期：${d.label}（${formatGameTime(d.due)}）`);
}

export function applyWorld(
  draft: Draft<WorldClockState>,
  command: WorldCommand,
  now: number,
  data: Readonly<Record<string, unknown>> = {},
): ApplyOutcome {
  const beforeLocation = draft.location;
  const notes: string[] = [];
  let target = now;
  if (command.time !== undefined) {
    if (command.time >= now) target = command.time;
    else
      notes.push(
        `时间不能倒退：${formatGameTime(command.time)} 早于现在 ${formatGameTime(now)}，时间没动`,
      );
  } else if (command.phases !== undefined && command.phases > 0) {
    target = now + command.phases * MINUTES_PER_PHASE;
  }
  if (command.location !== undefined && typeof command.location === "object") {
    const made = createPlace(draft, command.location, data, target);
    if (!made.ok) return made;
    notes.push(...(made.notes ?? []));
  } else if (command.location !== undefined) {
    const resolved = resolveLocation(draft, command.location, data, target);
    if (!resolved.ok) return fail(resolved.reason);
    if (resolved.note) notes.push(resolved.note);
    if (resolved.id !== draft.location) {
      draft.location = resolved.id;
      markVisit(draft, resolved.id, target);
      notes.push(`来到 ${resolved.id}`);
    }
  }

  // 3.0 相位与疲劳推进
  const crossedPhases =
    command.phases ??
    Math.max(
      phaseIndexOf(target) !== phaseIndexOf(now) ? 1 : 0,
      Math.floor((target - now) / MINUTES_PER_PHASE),
    );
  if (command.activity === "rest") {
    draft.phasesAwake = 0;
  } else if (crossedPhases > 0) {
    const beforeFatigued = isFatigued(draft);
    draft.phasesAwake = (draft.phasesAwake ?? 0) + crossedPhases;
    if (!beforeFatigued && isFatigued(draft)) {
      notes.push("连续 4 相位未睡眠，进入【疲劳】状态（全属性 −1）");
    }
  }

  if (target > now) {
    const phase = phaseIndexOf(target);
    notes.push(
      `${formatGameTime(target)}（${PERIOD_LABELS[periodOf(target)]} · ${PHASE_LABELS[phase]}）`,
    );
  }
  notes.push(...dueNotes(draft, now, target));
  const signals = command.activity === "rest" ? ["rest"] : [];
  if (draft.location !== beforeLocation) signals.push("world.arrived");
  return target > now
    ? { ok: true, notes, advanceTo: target, signals }
    : { ok: true, notes, signals };
}

export function applyDeadline(
  draft: Draft<WorldClockState>,
  command: DeadlineCommand,
  now: number,
): ApplyOutcome {
  const existing = draft.deadlines.find((d) => d.id === command.id);
  if (command.action === "add") {
    const { label, due } = command;
    if (label === undefined || due === undefined) return fail("添加期限要写 label 和 due");
    if (existing) return fail(`期限 ${command.id} 已经存在`);
    if (due <= now) return fail(`期限必须晚于现在（${formatGameTime(now)}）`);
    draft.deadlines.push({ id: command.id, label, due, handledAt: null });
    return { ok: true, notes: [`新期限：${label}，${formatGameTime(due)} 前`] };
  }
  if (!existing) return fail(`没有期限 ${command.id}`);
  if (existing.handledAt !== null) return fail(`期限 ${command.id} 已经回应过`);
  existing.handledAt = now;
  const early = existing.due > now;
  return { ok: true, notes: [`${early ? "提前办完" : "已回应"}：${existing.label}`] };
}

export function endScene(draft: Draft<WorldClockState>, now: number): ApplyOutcome {
  draft.scene += 1;
  draft.sceneStartedAt = now;
  return { ok: true, notes: ["场景结束"], signals: ["scene.end"] };
}
