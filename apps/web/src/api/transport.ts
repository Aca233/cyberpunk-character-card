import type { TurnEvent } from "@cp/core";
import type { LocalBackend } from "@cp/server/browser";

/**
 * 构建开关：VITE_CP_BACKEND=local 时整个游戏在浏览器里跑（静态网站），存档存在 IndexedDB，
 * 网页拿玩家自己的密钥直接调模型；不设时照旧走同源的 /api，由本机服务器处理（开发模式）。
 * 本地服务层按需动态加载，连服务器的构建里不会带上它
 */
export const LOCAL_MODE = import.meta.env.VITE_CP_BACKEND === "local";

let backend: Promise<LocalBackend> | undefined;
let origin = "http://localhost";

function localBackend(): Promise<LocalBackend> {
  backend ??= import("@cp/server/browser").then((m) => {
    origin = m.LOCAL_ORIGIN;
    return m.createLocalBackend();
  });
  return backend;
}

/** 和 fetch 一样用；path 不带 /api 前缀 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!LOCAL_MODE) return fetch(`/api${path}`, init);
  const local = await localBackend();
  return local.fetch(new Request(`${origin}/api${path}`, init));
}

export interface TurnSubscriber {
  readonly onEvent: (event: TurnEvent) => void;
  readonly onLost: (reason: string) => void;
}

/**
 * 本地模式下订阅一轮的事件：直接跟内存里的 TurnHub，从第一个事件开始补收，到终止事件为止。
 * 返回取消订阅的函数
 */
export function followLocalTurn(
  saveId: string,
  turnId: string,
  isTerminal: (event: TurnEvent) => boolean,
  handlers: TurnSubscriber,
): () => void {
  let closed = false;
  const close = () => {
    closed = true;
  };
  void (async () => {
    const { hub } = await localBackend();
    const run = hub.get(saveId, turnId);
    if (!run) {
      if (!closed) handlers.onLost("这一轮已经找不到了，可能已经过期或页面刷新过");
      close();
      return;
    }
    for await (const [, event] of hub.follow(run, 0, () => closed)) {
      if (closed) return;
      handlers.onEvent(event);
      if (isTerminal(event)) {
        close();
        return;
      }
    }
  })().catch((error: unknown) => {
    if (closed) return;
    close();
    handlers.onLost(
      `读取这一轮的进度出错：${error instanceof Error ? error.message : String(error)}`,
    );
  });
  return close;
}
