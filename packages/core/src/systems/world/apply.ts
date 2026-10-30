import type { Draft } from "immer";
import type { ApplyOutcome } from "../../kernel/system";
import { markVisit, resolveLocation } from "./places";
import type { Deadline, DeadlineCommand, WorldClockState, WorldCommand } from "./schema";

const MINUTES_PER_DAY = 1440;

export type Period = "dawn" | "day" | "dusk" | "night";

export const PERIOD_LABELS: Readonly<Record<Period, string>> = {
  dawn: "清晨",
  day: "白天",
  dusk: "傍晚",
  night: "深夜",
};

/** 时段的起点（小时），只作显示用 */
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

/**
 * 时间只往前走，倒退的不改；没写 time 时间不动；地点随指令更新。
 * 地点先按地点表和地点簿换成 id（places-plan §四：中文名对得上的用原来那条；poi:、ft: 第一次去的记进地点簿）
 */
export function applyWorld(
  draft: Draft<WorldClockState>,
  command: WorldCommand,
  now: number,
  data: Readonly<Record<string, unknown>> = {},
): ApplyOutcome {
  const notes: string[] = [];
  let target = now;
  if (command.time !== undefined) {
    if (command.time >= now) target = command.time;
    else
      notes.push(
        `时间不能倒退：${formatGameTime(command.time)} 早于现在 ${formatGameTime(now)}，时间没动`,
      );
  }
  if (command.location !== undefined) {
    const resolved = resolveLocation(draft, command.location, data, target);
    if (!resolved.ok) return fail(resolved.reason);
    if (resolved.note) notes.push(resolved.note);
    if (resolved.id !== draft.location) {
      draft.location = resolved.id;
      markVisit(draft, resolved.id, target);
      notes.push(`来到 ${resolved.id}`);
    }
  }
  if (target > now) notes.push(`${formatGameTime(target)}（${PERIOD_LABELS[periodOf(target)]}）`);
  notes.push(...dueNotes(draft, now, target));
  const signals = command.activity === "rest" ? ["rest"] : [];
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

/** 场景结束：不推进时间（过了多久由叙事模型在 world 里写），广播 scene.end */
export function endScene(draft: Draft<WorldClockState>, now: number): ApplyOutcome {
  draft.scene += 1;
  draft.sceneStartedAt = now;
  return { ok: true, notes: ["场景结束"], signals: ["scene.end"] };
}
