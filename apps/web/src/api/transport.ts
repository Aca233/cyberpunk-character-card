import type { TurnEvent } from "@cp/core";
import type { LocalBackend } from "@cp/server/browser";

/**
 * 纯前端静态运行层：整个游戏在浏览器里运行，存档与密钥存在 IndexedDB，
 * 网页拿玩家自己的密钥直接调模型，事件流直接订阅内存里的 TurnHub。
 */

/**
 * 多标签页：本地服务层的回合和锁都在页面内存里，两个标签页同时写同一份存档会互相顶掉。
 * 用 Web Locks 保证同一时间只有一个标签页在跑：
 * - checking：还在问浏览器
 * - owner：这个标签页在用
 * - elsewhere：另一个标签页在用；那边关掉后这里自动接上，也可以点「在这里继续」接管
 * - taken：本来在这里用，被别的标签页接管了；这里不再发任何请求，要刷新才能再用
 * 浏览器不支持 Web Locks 时直接当 owner
 */
export type TabState = "checking" | "owner" | "elsewhere" | "taken";

const LOCK = "cp-local-backend";
let tab: TabState = "checking";
let claimed = false;
let waiting: AbortController | undefined;
const watchers = new Set<() => void>();
let markOwned: () => void = () => {};
const owned = new Promise<void>((resolve) => {
  markOwned = resolve;
});

function setTab(next: TabState) {
  if (tab === "taken") return;
  tab = next;
  if (next === "owner") markOwned();
  for (const watch of watchers) watch();
}

function requestLock(options: LockOptions) {
  let granted = false;
  navigator.locks
    .request(LOCK, options, (lock) => {
      if (!lock) {
        setTab("elsewhere");
        waitForLock();
        return;
      }
      granted = true;
      setTab("owner");
      // 一直拿着，直到页面关掉或被接管
      return new Promise<never>(() => {});
    })
    .catch(() => {
      // 拿到过锁又被打断，只能是别的标签页 steal 了；排队被取消（AbortError）不用管
      if (granted) setTab("taken");
    });
}

function waitForLock() {
  waiting = new AbortController();
  requestLock({ signal: waiting.signal });
}

function claimTab() {
  if (claimed) return;
  claimed = true;
  if (typeof navigator === "undefined" || !("locks" in navigator)) {
    setTab("owner");
    return;
  }
  requestLock({ ifAvailable: true });
}

/** 给 useSyncExternalStore 用 */
export function subscribeTab(watch: () => void): () => void {
  claimTab();
  watchers.add(watch);
  return () => watchers.delete(watch);
}
export const tabState = (): TabState => tab;

/** 「在这里继续」：从另一个标签页手里接管；那边会停用 */
export function takeOverTab() {
  if (tab !== "elsewhere") return;
  waiting?.abort();
  requestLock({ steal: true });
}

let browserModule: Promise<typeof import("@cp/server/browser")> | undefined;
let backend: Promise<LocalBackend> | undefined;
let origin = "http://localhost";

function loadBrowserServerModule(): Promise<typeof import("@cp/server/browser")> {
  browserModule ??= import("@cp/server/browser");
  return browserModule;
}

function localBackend(): Promise<LocalBackend> {
  claimTab();
  const modulePromise = loadBrowserServerModule();
  backend ??= owned.then(() =>
    modulePromise.then((m) => {
      origin = m.LOCAL_ORIGIN;
      return m.createLocalBackend();
    }),
  );
  return backend;
}

/**
 * 启动期预热：并行拉取浏览器本地服务层 JS chunk；若本标签页持有锁，则一并提前完成 IndexedDB 初始化。
 * 不破坏多标签页 Web Locks 互斥协议，失败静默交由后续正式请求上报。
 */
export function warmLocalBackend(): void {
  if (tab === "taken") return;
  void loadBrowserServerModule().catch(() => {});
  void localBackend().catch(() => {});
}

class TabTakenError extends Error {
  override name = "TabTakenError";
  constructor() {
    super("游戏已经在另一个标签页继续，这个标签页停用了；刷新后可以重新接管");
  }
}

/** 和 fetch 一样用；path 不带 /api 前缀。另一个标签页在用时会等到这里拿到锁 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (tab === "taken") throw new TabTakenError();
  const local = await localBackend();
  // 等锁期间可能被接管；await 之后重新读一次，不沿用前面的类型收窄
  if (tabState() === "taken") throw new TabTakenError();
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
