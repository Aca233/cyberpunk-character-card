import type { TurnEvent } from "@cp/core";
import { followLocalTurn } from "./transport";

const TERMINAL: ReadonlySet<string> = new Set([
  "done",
  "blocked",
  "confirmSpend",
  "stopped",
  "error",
]);
const isTerminal = (event: TurnEvent) => TERMINAL.has(event.type);

export interface FollowHandlers {
  readonly onEvent: (event: TurnEvent) => void;
  /** 这一轮在本地运行状态里找不到了（页面刷新过或已过期）；调用方刷新存档状态 */
  readonly onLost: (reason: string) => void;
}

/**
 * 订阅一轮的事件流：直接订阅内存里的 TurnHub，从第一个事件开始补收到终止事件。
 * 返回取消订阅的函数
 */
export function followTurn(saveId: string, turnId: string, handlers: FollowHandlers): () => void {
  return followLocalTurn(saveId, turnId, isTerminal, handlers);
}
