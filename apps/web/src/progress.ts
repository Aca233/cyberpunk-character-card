/**
 * 进度事件（witch-paintbox 借鉴第 2 条，用户定的，2026-11-02）：
 * - 每个开始恰好有一个结束：结束的句柄可以重复调用，只有第一次算数
 * - 结束带类别：成功是 ok，其余照失败原因分类，界面和日志按类别处理，不用解析文字
 * - 监听出错不影响主流程：每个监听单独 try，抛的错只打到控制台
 * 只在网页里，不写存档；以后改成纯前端时模型调用也走这一套
 */

/** 哪一类进度；现在只有一轮生成，以后加别的往这里添 */
export type ProgressKind = "turn";

export type EndCategory =
  /** 正常结束 */
  | "ok"
  /** 要先确认一大笔花销，这一轮没开始写 */
  | "confirmSpend"
  /** 被安全过滤拦下 */
  | "blocked"
  /** 玩家停止 */
  | "stopped"
  /** 模型或网络出错 */
  | "error"
  /** 模型没配好 */
  | "unavailable"
  /** 后端拒绝：版本过期、已掷过骰、检定失效 */
  | "rejected"
  /** 事件流断了 */
  | "lost"
  /** 被别的操作顶掉：换了存档、开了新的一轮 */
  | "aborted";

export type ProgressEvent =
  | {
      readonly type: "start";
      readonly id: number;
      readonly kind: ProgressKind;
      readonly at: number;
    }
  | {
      readonly type: "end";
      readonly id: number;
      readonly kind: ProgressKind;
      readonly at: number;
      readonly category: EndCategory;
      readonly message?: string | undefined;
    };

export interface ProgressHandle {
  readonly id: number;
  readonly kind: ProgressKind;
  /** 结束这次进度；已经结束过的返回 false，什么都不发 */
  end(category: EndCategory, message?: string): boolean;
}

type Listener = (event: ProgressEvent) => void;

const listeners = new Set<Listener>();
const open = new Map<number, ProgressKind>();
let nextId = 1;

function emit(event: ProgressEvent): void {
  for (const listener of [...listeners]) {
    try {
      listener(event);
    } catch (error) {
      // 监听出错只记下来，不往外抛，也不影响别的监听
      console.error("进度监听出错", error);
    }
  }
}

/** 开始一次进度，发出 start；拿到的句柄负责发唯一的一次 end */
export function beginProgress(kind: ProgressKind): ProgressHandle {
  const id = nextId++;
  open.set(id, kind);
  emit({ type: "start", id, kind, at: Date.now() });
  return {
    id,
    kind,
    end(category, message) {
      if (!open.delete(id)) return false;
      emit({
        type: "end",
        id,
        kind,
        at: Date.now(),
        category,
        ...(message === undefined ? {} : { message }),
      });
      return true;
    },
  };
}

/** 订阅进度事件；返回取消订阅 */
export function onProgress(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 还没结束的进度，调试和测试用 */
export function openProgress(): readonly { readonly id: number; readonly kind: ProgressKind }[] {
  return [...open].map(([id, kind]) => ({ id, kind }));
}
