import {
  isTerminalEvent,
  type TurnCheckpointStage,
  type TurnCompletionOutcome,
  type TurnEvent,
  type TurnInput,
  type TurnStage,
  turnInputKey,
} from "@cp/core";
import { randomId } from "./random";

/** 结束的轮次在内存里留 10 分钟，网页断线重连还能补收终止事件 */
export const FINISHED_RETAIN_MS = 10 * 60 * 1000;

export interface TurnRun {
  readonly turnId: string;
  /** 当前保留窗口内，相同版本与输入的首次尝试；只用于关联重试，不包含输入。 */
  readonly logicalTurnId: string;
  readonly attemptIndex: number;
  readonly saveId: string;
  readonly requestId: string;
  readonly baseVersion: number;
  readonly input: TurnInput;
  readonly controller: AbortController;
  /** 下标就是 SSE 的事件 id */
  readonly events: TurnEvent[];
  readonly startedAt: number;
  /** 执行入口携带有效断点的续跑尝试；不代表该尝试已成功完成恢复。 */
  restoredStage: TurnCheckpointStage | undefined;
  lastStage: TurnStage | undefined;
  stageStartedAt: number | null;
  readonly stageDurationsMs: Partial<Record<TurnStage, number>>;
  /** 已通过写盘前核对并开始不可逆写入存档，不再接受中途停止 */
  committing: boolean;
  finishedAt: number | null;
}

type RunOutcome =
  | TurnCompletionOutcome
  | "blocked"
  | "confirmSpend"
  | "stopped"
  | "error"
  | "inProgress";

function runOutcome(run: TurnRun): RunOutcome {
  const terminal = run.events.at(-1);
  if (!terminal || !isTerminalEvent(terminal)) return "inProgress";
  return terminal.type === "done" ? terminal.outcome : terminal.type;
}

/** 最近邻百分位；空样本不报 0，避免误认为没有延迟。 */
function percentile(sorted: readonly number[], ratio: number): number | null {
  return sorted.length === 0 ? null : (sorted[Math.ceil(sorted.length * ratio) - 1] ?? null);
}

/**
 * 正在生成和刚结束的轮次。只在内存里：后端重启后进行中的轮次直接作废，
 * 因为正文只在结束时写进回合日志，作废不会留下半条记录
 */
export class TurnHub {
  private readonly runs = new Map<string, TurnRun>();
  private readonly waiters = new Map<string, Set<() => void>>();
  private firstStartedAt: number | null = null;

  constructor(private readonly now: () => number = Date.now) {}

  start(saveId: string, requestId: string, baseVersion: number, input: TurnInput): TurnRun {
    this.sweep();
    const startedAt = this.now();
    this.firstStartedAt ??= startedAt;
    const inputKey = turnInputKey(input);
    let previous: TurnRun | undefined;
    for (const candidate of this.runs.values()) {
      if (
        candidate.saveId === saveId &&
        candidate.baseVersion === baseVersion &&
        turnInputKey(candidate.input) === inputKey
      ) {
        previous = candidate;
      }
    }
    const turnId = randomId();
    const run: TurnRun = {
      turnId,
      logicalTurnId: previous?.logicalTurnId ?? turnId,
      attemptIndex: (previous?.attemptIndex ?? 0) + 1,
      saveId,
      requestId,
      baseVersion,
      input,
      controller: new AbortController(),
      events: [],
      startedAt,
      restoredStage: undefined,
      lastStage: undefined,
      stageStartedAt: null,
      stageDurationsMs: {},
      committing: false,
      finishedAt: null,
    };
    this.runs.set(run.turnId, run);
    this.push(run, { type: "started", turnId: run.turnId, requestId, baseVersion });
    return run;
  }

  get(saveId: string, turnId: string): TurnRun | undefined {
    const run = this.runs.get(turnId);
    return run?.saveId === saveId ? run : undefined;
  }

  running(saveId: string): TurnRun | undefined {
    for (const run of this.runs.values())
      if (run.saveId === saveId && run.finishedAt === null) return run;
    return undefined;
  }

  byRequest(saveId: string, requestId: string): TurnRun | undefined {
    for (const run of this.runs.values())
      if (run.saveId === saveId && run.requestId === requestId) return run;
    return undefined;
  }

  /** 追加事件；终止事件之后的事件一律忽略 */
  push(run: TurnRun, event: TurnEvent): void {
    if (run.finishedAt !== null) return;
    const now = this.now();
    if ((event.type === "stage" || isTerminalEvent(event)) && run.lastStage !== undefined) {
      const elapsed = Math.max(0, now - (run.stageStartedAt ?? now));
      run.stageDurationsMs[run.lastStage] = (run.stageDurationsMs[run.lastStage] ?? 0) + elapsed;
      run.stageStartedAt = null;
    }
    if (event.type === "stage") {
      run.lastStage = event.stage;
      run.stageStartedAt = now;
    }
    run.events.push(event);
    if (isTerminalEvent(event)) run.finishedAt = now;
    const waiting = this.waiters.get(run.turnId);
    if (waiting) {
      this.waiters.delete(run.turnId);
      for (const wake of waiting) wake();
    }
  }

  /**
   * 只描述本页运行时仍保留的尝试；不落新日志、不导出输入或错误正文。
   * finishedAt 超过保留期的样本会淘汰，因此不能当作跨刷新或历史全量成功率。
   */
  diagnostics(saveId: string) {
    this.sweep();
    const now = this.now();
    const runs = [...this.runs.values()].filter((run) => run.saveId === saveId);
    const counts: Record<RunOutcome, number> = {
      complete: 0,
      draft: 0,
      unsettled: 0,
      ooc: 0,
      blocked: 0,
      confirmSpend: 0,
      stopped: 0,
      error: 0,
      inProgress: 0,
    };
    const logicalTurns = new Map<string, TurnRun[]>();
    const durations: number[] = [];
    for (const run of runs) {
      counts[runOutcome(run)] += 1;
      const attempts = logicalTurns.get(run.logicalTurnId) ?? [];
      attempts.push(run);
      logicalTurns.set(run.logicalTurnId, attempts);
      if (run.finishedAt !== null) durations.push(Math.max(0, run.finishedAt - run.startedAt));
    }
    durations.sort((a, b) => a - b);
    const groups = [...logicalTurns.values()];
    return {
      scope: "current-runtime-retained-runs" as const,
      observedAt: new Date(now).toISOString(),
      runtimeFirstStartedAt:
        this.firstStartedAt === null ? null : new Date(this.firstStartedAt).toISOString(),
      retention: {
        finishedWithinMs: FINISHED_RETAIN_MS,
        finishedAfter: new Date(now - FINISHED_RETAIN_MS).toISOString(),
        includesAllInProgress: true,
        persistsAcrossReload: false,
      },
      attempts: {
        accepted: runs.length,
        finished: durations.length,
        resumedFromCheckpoint: runs.filter((run) => run.restoredStage !== undefined).length,
        outcomes: counts,
      },
      logicalTurns: {
        observed: groups.length,
        /** 原始尝试可能已过保留期；不能把观察到的第一条错误当成真正的首试。 */
        firstAttemptsIncluded: groups.filter((group) => group.some((run) => run.attemptIndex === 1))
          .length,
        firstAttemptComplete: groups.filter((group) =>
          group.some((run) => run.attemptIndex === 1 && runOutcome(run) === "complete"),
        ).length,
        complete: groups.filter((group) => group.some((run) => runOutcome(run) === "complete"))
          .length,
        retriedInWindow: groups.filter((group) => group.length > 1).length,
      },
      latencyMs: {
        scope: "finished-attempts-including-non-success" as const,
        samples: durations.length,
        p50: percentile(durations, 0.5),
        p95: percentile(durations, 0.95),
      },
      samples: runs.map((run) => {
        const stageDurationsMs = { ...run.stageDurationsMs };
        if (run.lastStage !== undefined && run.stageStartedAt !== null) {
          stageDurationsMs[run.lastStage] =
            (stageDurationsMs[run.lastStage] ?? 0) + Math.max(0, now - run.stageStartedAt);
        }
        return {
          turnId: run.turnId,
          logicalTurnId: run.logicalTurnId,
          attemptIndex: run.attemptIndex,
          baseVersion: run.baseVersion,
          startedAt: new Date(run.startedAt).toISOString(),
          finishedAt: run.finishedAt === null ? null : new Date(run.finishedAt).toISOString(),
          elapsedMs: Math.max(0, (run.finishedAt ?? now) - run.startedAt),
          outcome: runOutcome(run),
          lastStage: run.lastStage ?? null,
          restoredStage: run.restoredStage ?? null,
          stageDurationsMs,
        };
      }),
    };
  }

  /** 从第 from 个事件开始依次给出，直到终止事件；closed 变成 true 时提前结束 */
  async *follow(
    run: TurnRun,
    from: number,
    closed: () => boolean,
  ): AsyncGenerator<[number, TurnEvent]> {
    let next = Math.max(0, from);
    while (!closed()) {
      if (run.finishedAt !== null) {
        const lastIndex = run.events.length - 1;
        const last = lastIndex >= next ? run.events[lastIndex] : undefined;
        if (last?.type === "stopped") {
          yield [lastIndex, last];
          return;
        }
      }
      while (next < run.events.length) {
        const event = run.events[next] as TurnEvent;
        yield [next, event];
        next += 1;
        if (isTerminalEvent(event)) return;
      }
      if (run.finishedAt !== null) return;
      await new Promise<void>((resolve) => {
        const set = this.waiters.get(run.turnId) ?? new Set();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const wake = () => {
          if (timer !== undefined) clearTimeout(timer);
          set.delete(wake);
          if (set.size === 0 && this.waiters.get(run.turnId) === set) {
            this.waiters.delete(run.turnId);
          }
          resolve();
        };
        set.add(wake);
        this.waiters.set(run.turnId, set);
        // 定时醒来检查 closed，网页断开后不让等待一直挂着；Node 上 unref 不挡退出，浏览器没有 unref
        timer = setTimeout(wake, 15_000);
        (timer as unknown as { unref?: () => void }).unref?.();
      });
    }
  }

  private sweep(): void {
    const cutoff = this.now() - FINISHED_RETAIN_MS;
    for (const [id, run] of this.runs)
      if (run.finishedAt !== null && run.finishedAt < cutoff) this.runs.delete(id);
  }
}
