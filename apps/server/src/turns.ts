import { randomUUID } from "node:crypto";
import { isTerminalEvent, type TurnEvent } from "@cp/core";

/** 结束的轮次在内存里留 10 分钟，网页断线重连还能补收终止事件 */
export const FINISHED_RETAIN_MS = 10 * 60 * 1000;

export interface TurnRun {
  readonly turnId: string;
  readonly saveId: string;
  readonly requestId: string;
  readonly baseVersion: number;
  readonly controller: AbortController;
  /** 下标就是 SSE 的事件 id */
  readonly events: TurnEvent[];
  finishedAt: number | null;
}

/**
 * 正在生成和刚结束的轮次。只在内存里：后端重启后进行中的轮次直接作废，
 * 因为正文只在结束时写进回合日志，作废不会留下半条记录
 */
export class TurnHub {
  private readonly runs = new Map<string, TurnRun>();
  private readonly waiters = new Map<string, Set<() => void>>();

  constructor(private readonly now: () => number = Date.now) {}

  start(saveId: string, requestId: string, baseVersion: number): TurnRun {
    this.sweep();
    const run: TurnRun = {
      turnId: randomUUID(),
      saveId,
      requestId,
      baseVersion,
      controller: new AbortController(),
      events: [],
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
    run.events.push(event);
    if (isTerminalEvent(event)) run.finishedAt = this.now();
    const waiting = this.waiters.get(run.turnId);
    if (waiting) {
      this.waiters.delete(run.turnId);
      for (const wake of waiting) wake();
    }
  }

  /** 从第 from 个事件开始依次给出，直到终止事件；closed 变成 true 时提前结束 */
  async *follow(
    run: TurnRun,
    from: number,
    closed: () => boolean,
  ): AsyncGenerator<[number, TurnEvent]> {
    let next = Math.max(0, from);
    while (!closed()) {
      while (next < run.events.length) {
        const event = run.events[next] as TurnEvent;
        yield [next, event];
        next += 1;
        if (isTerminalEvent(event)) return;
      }
      if (run.finishedAt !== null) return;
      await new Promise<void>((resolve) => {
        const set = this.waiters.get(run.turnId) ?? new Set();
        set.add(resolve);
        this.waiters.set(run.turnId, set);
        // 定时醒来检查 closed，网页断开后不让等待一直挂着
        setTimeout(resolve, 15_000).unref();
      });
    }
  }

  private sweep(): void {
    const cutoff = this.now() - FINISHED_RETAIN_MS;
    for (const [id, run] of this.runs)
      if (run.finishedAt !== null && run.finishedAt < cutoff) this.runs.delete(id);
  }
}
