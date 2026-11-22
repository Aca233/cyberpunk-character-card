import { type Dispatch, type SetStateAction, useCallback, useEffect } from "react";
import { useLayer } from "../../ui/layers";

/**
 * 视野里就地展开：
 * 仅靠点击卡片或快捷键（P/J/T/O）展开与收起，鼠标悬停不自动打开；
 * 展开后进入面板栈，按 Esc 收起，同一时间只展开一处。
 */

/** 展开的是哪一处：四角的块或某个在场的人 */
export type Expand = string;

export type SetExpand = Dispatch<SetStateAction<Expand | null>>;

/** 展开层各自的「是不是栈顶」：剧情页的快捷键在展开层位于栈顶时照常响应 */
const openTops = new Set<() => boolean>();

/** 面板栈最上面是不是一个角块展开层（不是商店、确认框这类要独占键盘的层） */
export function peekOnTop(): boolean {
  for (const isTop of openTops) if (isTop()) return true;
  return false;
}

export function usePeek(id: string, expand: Expand | null, setExpand: SetExpand) {
  const open = expand === id;

  const close = useCallback(() => {
    setExpand((cur) => (cur === id ? null : cur));
  }, [id, setExpand]);

  const toggle = useCallback(() => {
    setExpand((cur) => (cur === id ? null : id));
  }, [id, setExpand]);

  // 展开后占面板栈：Esc 收起，一次退一层
  const isTop = useLayer(close, open);
  useEffect(() => {
    if (!open) return;
    openTops.add(isTop);
    return () => {
      openTops.delete(isTop);
    };
  }, [open, isTop]);

  return {
    open,
    isTop,
    close,
    toggle,
  };
}
