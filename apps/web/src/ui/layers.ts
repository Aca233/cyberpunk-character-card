import { useCallback, useEffect, useRef } from "react";

/**
 * 面板栈：开着的面板、对话框按打开顺序压栈，Esc 只交给栈顶，一次退一层。
 * 全局只有一个键盘监听（捕获阶段，先于其他监听），面板自己不再监听 Esc。
 * 见 2077-interface-plan.md 第七节
 */

interface Layer {
  readonly onEscape: () => void;
}

const stack: Layer[] = [];
let installed = false;

function onKey(e: KeyboardEvent) {
  if (e.key !== "Escape") return;
  const top = stack.at(-1);
  if (!top) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  // 长按产生的重复事件也要拦住，但一次按下只退一层
  if (e.repeat) return;
  top.onEscape();
}

/**
 * 把一个面板压进栈；active 为 false 时不占栈（比如面板里的确认框开着时由确认框占栈顶）。
 * 返回「自己是不是栈顶」：神经界面的 Q/E 和页面键只在上面没有别的层时响应
 */
export function useLayer(onEscape: () => void, active = true): () => boolean {
  const handler = useRef(onEscape);
  const self = useRef<Layer | null>(null);
  useEffect(() => {
    handler.current = onEscape;
  });
  useEffect(() => {
    if (!active) return;
    if (!installed) {
      window.addEventListener("keydown", onKey, true);
      installed = true;
    }
    const layer: Layer = { onEscape: () => handler.current() };
    stack.push(layer);
    self.current = layer;
    return () => {
      const i = stack.indexOf(layer);
      if (i >= 0) stack.splice(i, 1);
      if (self.current === layer) self.current = null;
    };
  }, [active]);
  return useCallback(() => self.current !== null && stack.at(-1) === self.current, []);
}

/** 有没有面板开着：开着时正文的快捷键（数字键、页面键）不响应 */
export function layerOpen(): boolean {
  return stack.length > 0;
}
