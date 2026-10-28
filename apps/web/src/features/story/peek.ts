import {
  type Dispatch,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { useLayer } from "../../ui/layers";

/**
 * 视野里就地展开（2077-interface-plan.md 第十二节第 4 条）：
 * 鼠标停 150ms 才展开，移开留 250ms 宽限；点一下钉住，钉住后走面板栈，Esc 收起；
 * 同一时间只展开一处。正在打字时不因悬停展开；触屏没有悬停，先不做
 */

export interface Expand {
  /** 展开的是哪一处：四角的块、某个在场的人或某一侧的抽屉 */
  readonly id: string;
  readonly pinned: boolean;
}

export type SetExpand = Dispatch<SetStateAction<Expand | null>>;

/** 鼠标在块上停稳这么久才展开；一路划过去不算（每次移动重新计时） */
const OPEN_MS = 180;
const CLOSE_MS = 300;
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

/** 点击落在展开出来的部分或里面的按钮上时，不当成点了块本身 */
function insideContent(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest("[data-peek-panel], button, a, input, textarea, select") !== null
  );
}

export function usePeek(
  id: string,
  expand: Expand | null,
  setExpand: SetExpand,
  /** 点块本身时做什么；不传就是钉住或取消钉住 */
  onActivate?: () => void,
) {
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

  const onPointerEnter = useCallback(
    (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      window.clearTimeout(closeTimer.current);
      if (open) return;
      if (Date.now() - lastTyped < TYPING_MS) return;
      window.clearTimeout(openTimer.current);
      openTimer.current = window.setTimeout(() => {
        // 别处钉住了就不抢；没钉住的换成这一处
        setExpand((cur) => (cur?.pinned ? cur : { id, pinned: false }));
      }, OPEN_MS);
    },
    [open, id, setExpand],
  );

  // 还没展开时每动一下就重新计时：只有停稳才展开，鼠标一路划过四角不会乱弹
  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || open) return;
      if (Date.now() - lastTyped < TYPING_MS) return;
      window.clearTimeout(openTimer.current);
      openTimer.current = window.setTimeout(() => {
        setExpand((cur) => (cur?.pinned ? cur : { id, pinned: false }));
      }, OPEN_MS);
    },
    [open, id, setExpand],
  );

  const onPointerLeave = useCallback(
    (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      window.clearTimeout(openTimer.current);
      window.clearTimeout(closeTimer.current);
      closeTimer.current = window.setTimeout(() => {
        setExpand((cur) => (cur?.id === id && !cur.pinned ? null : cur));
      }, CLOSE_MS);
    },
    [id, setExpand],
  );

  const pin = useCallback(() => {
    clearTimers();
    setExpand((cur) => (cur?.id === id && cur.pinned ? null : { id, pinned: true }));
  }, [clearTimers, id, setExpand]);

  const activate = onActivate ?? pin;

  const onClick = useCallback(
    (e: MouseEvent) => {
      if (insideContent(e.target)) return;
      activate();
    },
    [activate],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      if (insideContent(e.target) && e.target !== e.currentTarget) return;
      e.preventDefault();
      activate();
    },
    [activate],
  );

  return {
    open,
    pinned,
    isTop,
    close,
    /** 挂在块的根元素上 */
    bind: { onPointerEnter, onPointerMove, onPointerLeave, onClick, onKeyDown },
  };
}
