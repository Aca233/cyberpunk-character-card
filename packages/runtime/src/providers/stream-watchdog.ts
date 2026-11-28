import type { AbortSignalLike, LlmClient, LlmEvent, LlmRequest } from "@cp/core";
import { AbortedError, UpstreamError } from "./http";

export interface LlmTimeoutBudget {
  readonly connectMs: number;
  readonly firstEventMs: number;
  readonly idleMs: number;
  readonly totalMs: number;
}

export type LlmTimeoutPhase = "connect" | "first-event" | "idle" | "total";

const TIMEOUT_LABELS: Record<LlmTimeoutPhase, string> = {
  connect: "连接模型超时",
  "first-event": "等待模型开始生成超时",
  idle: "模型长时间没有继续生成",
  total: "本次模型请求超过总时长上限",
};

/** 与玩家主动停止分开；可手动重试，不自动重发结果不确定的请求。 */
export class LlmTimeoutError extends UpstreamError {
  constructor(readonly phase: LlmTimeoutPhase) {
    super(`${TIMEOUT_LABELS[phase]}，本次请求已终止；可检查连接或调整模型后重试`, undefined, true);
    this.name = "LlmTimeoutError";
  }
}

// 先使用宽松的分用途边界，避免正常长思考被误杀；后续按实际阶段耗时校准。
export function llmTimeoutBudget(request: LlmRequest): LlmTimeoutBudget {
  const narrative = request.purpose === "narrator" && request.responseFormat === undefined;
  const stage = request.responseFormat?.name;
  const shortStructured = stage === "judge" || stage === "repair" || stage === "summary";
  return {
    connectMs: 60_000,
    firstEventMs: narrative ? 240_000 : 180_000,
    idleMs: narrative ? 180_000 : 120_000,
    totalMs: (narrative ? 15 : shortStructured ? 8 : 10) * 60_000,
  };
}

const responseObservers = new WeakMap<AbortSignal, () => void>();

/** 仅由生成接口的响应头触发；缓存、鉴权等准备请求不冒充已连接模型。 */
export function markLlmConnected(signal?: AbortSignal): void {
  if (signal) responseObservers.get(signal)?.();
}

/**
 * 每次模型调用的统一时间边界。有效 text / thought 才刷新空闲计时，SSE 心跳无效。
 * Promise.race 也约束不响应 abort 的上游等待；真实 fetch / reader 同时收到取消信号。
 */
export async function* streamWithWatchdog(
  client: LlmClient,
  request: LlmRequest,
  callerSignal?: AbortSignalLike,
  budget: LlmTimeoutBudget = llmTimeoutBudget(request),
): AsyncGenerator<LlmEvent> {
  if (callerSignal?.aborted) throw new AbortedError();
  const controller = new AbortController();
  let phaseTimer: ReturnType<typeof setTimeout> | undefined;
  let totalTimer: ReturnType<typeof setTimeout> | undefined;
  let timeout: LlmTimeoutError | undefined;
  let rejectCancelled: ((error: Error) => void) | undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    rejectCancelled = reject;
  });
  // 取消可发生在消费端处理上一块期间，先绑定 rejection handler 防止未处理拒绝。
  void cancelled.catch(() => {});
  const cancel = (error: Error) => {
    rejectCancelled?.(error);
    controller.abort();
  };
  let abortCaller: (() => void) | undefined = () => cancel(new AbortedError());
  const onCallerAbort = () => abortCaller?.();
  callerSignal?.addEventListener("abort", onCallerAbort);
  // 自定义 AbortSignalLike 可能在注册监听期间变为 aborted。
  if (callerSignal?.aborted) onCallerAbort();

  const expire = (phase: LlmTimeoutPhase) => {
    if (controller.signal.aborted) return;
    timeout = new LlmTimeoutError(phase);
    cancel(timeout);
  };
  const arm = (phase: LlmTimeoutPhase, ms: number) => {
    if (phaseTimer !== undefined) clearTimeout(phaseTimer);
    phaseTimer = setTimeout(() => expire(phase), ms);
  };
  let connected = false;
  let effective = false;
  responseObservers.set(controller.signal, () => {
    if (connected || effective) return;
    connected = true;
    arm("first-event", budget.firstEventMs);
  });
  arm("connect", budget.connectMs);
  totalTimer = setTimeout(() => expire("total"), budget.totalMs);
  let iterator: AsyncIterator<LlmEvent> | undefined;
  try {
    iterator = client.stream(request, controller.signal)[Symbol.asyncIterator]();
    while (true) {
      const next = await Promise.race([iterator.next(), cancelled]);
      if (callerSignal?.aborted) throw new AbortedError();
      if (timeout) throw timeout;
      if (next.done) return;
      const event = next.value;
      if ((event.type === "text" || event.type === "thought") && event.text.trim() !== "") {
        effective = true;
        arm("idle", budget.idleMs);
      }
      if (event.type === "done" || event.type === "blocked") {
        if (phaseTimer !== undefined) clearTimeout(phaseTimer);
        if (totalTimer !== undefined) clearTimeout(totalTimer);
        yield event;
        return;
      }
      yield event;
    }
  } catch (error) {
    if (callerSignal?.aborted) throw new AbortedError();
    if (timeout) throw timeout;
    throw error;
  } finally {
    if (phaseTimer !== undefined) clearTimeout(phaseTimer);
    if (totalTimer !== undefined) clearTimeout(totalTimer);
    responseObservers.delete(controller.signal);
    const removable = callerSignal as
      | (AbortSignalLike & {
          removeEventListener?: (type: "abort", listener: () => void) => void;
        })
      | undefined;
    removable?.removeEventListener?.("abort", onCallerAbort);
    abortCaller = undefined;
    rejectCancelled = undefined;
    controller.abort();
    // 不等待不守取消约定的迭代器；其挂起 next 结束后仍会执行自身的 finally。
    void iterator?.return?.().catch(() => {});
  }
}
