import {
  type Dispatch,
  type PointerEvent,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { useLayer } from "../../ui/layers";

/**
 * 视野里就地展开（2077-interface-plan.md 第十二节第 4、8 条）：
 * 鼠标停稳才展开，移开留一点宽限再收起；不靠点击。
 * P/J/T 从剧情页钉住对应的块，钉住后走面板栈，Esc 收起；同一时间只展开一处。
 * 正在打字时不因悬停展开；触屏没有悬停，先不做
 */

export interface Expand {
  /** 展开的是哪一处：四角的块或某个在场的人 */
  readonly id: string;
  readonly pinned: boolean;
}

export type SetExpand = Dispatch<SetStateAction<Expand | null>>;

/**
 * 鼠标停稳 180ms 后再预览展开，防止掠过屏幕两侧误触；点击和快捷键依然 0ms 瞬开
 */
const OPEN_MS = 180;
const CLOSE_MS = 280;
/** 最后一次在输入框里按键之后多久之内算「正在打字」 */
const TYPING_MS = 800;

let lastTyped = 0;
let typingInstalled = false;

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.closest("input, textarea, select") !== null)
  );
}

function onTypingKey(e: globalThis.KeyboardEvent) {
  if (isTyping(e.target)) lastTyped = Date.now();
}

/** 钉住的展开层各自的「是不是栈顶」：剧情页的键在钉住的展开层在栈顶时照常响应 */
const pinnedTops = new Set<() => boolean>();

/** 面板栈最上面是不是一个钉住的展开层（不是商店、确认框这类要独占键盘的层） */
export function peekOnTop(): boolean {
  for (const isTop of pinnedTops) if (isTop()) return true;
  return false;
}

export function usePeek(id: string, expand: Expand | null, setExpand: SetExpand) {
  const openTimer = useRef<number | undefined>(undefined);
  const closeTimer = useRef<number | undefined>(undefined);
  const open = expand?.id === id;
  const pinned = open && expand.pinned;

  useEffect(() => {
    if (typingInstalled) return;
    window.addEventListener("keydown", onTypingKey, true);
    typingInstalled = true;
  }, []);

  const clearTimers = useCallback(() => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
    // 置空：arm 靠它判断「是不是已经在计时」
    openTimer.current = undefined;
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  const close = useCallback(() => {
    clearTimers();
    setExpand((cur) => (cur?.id === id ? null : cur));
  }, [clearTimers, id, setExpand]);

  // 钉住以后才占面板栈：Esc 收起，一次退一层
  const isTop = useLayer(close, pinned);
  useEffect(() => {
    if (!pinned) return;
    pinnedTops.add(isTop);
    return () => {
      pinnedTops.delete(isTop);
    };
  }, [pinned, isTop]);

  // 进块开始计时，已经在计时就不重来（用户嫌响应慢）；离开块时 clearTimers 取消，一路划过四角不会乱弹
  const arm = useCallback(() => {
    if (Date.now() - lastTyped < TYPING_MS || openTimer.current !== undefined) return;
    openTimer.current = window.setTimeout(() => {
      openTimer.current = undefined;
      // 别处钉住了就不抢；没钉住的换成这一处
      setExpand((cur) => (cur?.pinned ? cur : { id, pinned: false }));
    }, OPEN_MS);
  }, [id, setExpand]);

  const onPointerEnter = useCallback(
    (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      window.clearTimeout(closeTimer.current);
      if (!open) arm();
    },
    [open, arm],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || open) return;
      arm();
    },
    [open, arm],
  );

  const onPointerLeave = useCallback(
    (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      clearTimers();
      closeTimer.current = window.setTimeout(() => {
        setExpand((cur) => (cur?.id === id && !cur.pinned ? null : cur));
      }, CLOSE_MS);
    },
    [clearTimers, id, setExpand],
  );

  return {
    open,
    pinned,
    isTop,
    close,
    /** 挂在块的根元素上 */
    bind: { onPointerEnter, onPointerMove, onPointerLeave },
  };
}
