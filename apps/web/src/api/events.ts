import type { TurnEvent } from "@cp/core";

const NAMES = [
  "started",
  "rolled",
  "text",
  "done",
  "blocked",
  "confirmSpend",
  "stopped",
  "error",
] as const;

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
  /** 这一轮在后端找不到了（过期或后端重启），或者连接彻底断开；调用方刷新存档状态 */
  readonly onLost: (reason: string) => void;
}

/**
 * 订阅一轮的事件流。EventSource 断线后自己带 Last-Event-ID 重连，后端从下一个事件续发；
 * 收到终止事件后关闭。返回取消订阅的函数
 */
export function followTurn(saveId: string, turnId: string, handlers: FollowHandlers): () => void {
  const source = new EventSource(`/api/saves/${saveId}/turns/${turnId}/events`);
  let finished = false;
  const close = () => {
    finished = true;
    source.close();
  };
  for (const name of NAMES) {
    source.addEventListener(name, (raw) => {
      // 后端的 error 事件带 data；EventSource 自己的连接错误也叫 error，但没有 data
      if (!(raw instanceof MessageEvent) || typeof raw.data !== "string") {
        if (name === "error" && !finished && source.readyState === EventSource.CLOSED) {
          close();
          handlers.onLost("和后端的事件流断开了，这一轮可能已经过期");
        }
        return;
      }
      let event: TurnEvent;
      try {
        event = JSON.parse(raw.data) as TurnEvent;
      } catch {
        return;
      }
      if (finished) return;
      handlers.onEvent(event);
      if (isTerminal(event)) close();
    });
  }
  return close;
}
