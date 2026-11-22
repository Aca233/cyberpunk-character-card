import { type PointerEvent, useCallback, useEffect, useRef } from "react";

/**
 * 赛博卡片磁吸 3D 按压倾斜 + 鼠标跟随高光系统（零重渲染，走 rAF 写入 CSS 变量）。
 *
 * 物理直觉（按压感）：
 * - 鼠标移到卡片左上角时，左上角“被按下去”、右下角微微翘起（rotateX > 0, rotateY < 0），
 *   卡片整体顺着施力方向产生轻微物理偏移（--tilt-tx / --tilt-ty），阴影反向错位（--shadow-x / --shadow-y）。
 * - 鼠标按下（pointerdown）时额外压深一层（data-pressed + --tilt-press），松手弹回。
 * - 光标坐标以百分比写入 --mx / --my，驱动卡片表层漫反射镜面高光与边缘冷光流扫。
 * - 展开（disabled=true）或 prefers-reduced-motion: reduce 时自动归零，保证阅读与滚动绝对平稳。
 */
export interface CardTiltOptions {
  /** 禁用（例如 HUD 角块展开时归正，不倾斜） */
  readonly disabled?: boolean;
  /** 最大俯仰角（度），默认 7.5 */
  readonly maxRotate?: number;
  /** 最大位移偏移量（px），默认 5 */
  readonly maxShift?: number;
  /** 阴影反向视差偏移量（px），默认 8 */
  readonly shadowShift?: number;
}

function resetVars(el: HTMLElement) {
  el.style.removeProperty("--tilt-rx");
  el.style.removeProperty("--tilt-ry");
  el.style.removeProperty("--tilt-tx");
  el.style.removeProperty("--tilt-ty");
  el.style.removeProperty("--shadow-x");
  el.style.removeProperty("--shadow-y");
  el.style.removeProperty("--mx");
  el.style.removeProperty("--my");
  el.style.removeProperty("--tilt-angle");
  el.style.removeProperty("--tilt-glare");
  el.removeAttribute("data-tilting");
  el.removeAttribute("data-pressed");
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function useCardTilt<T extends HTMLElement = HTMLElement>({
  disabled = false,
  maxRotate = 7.5,
  maxShift = 5,
  shadowShift = 8,
}: CardTiltOptions = {}) {
  const elRef = useRef<T | null>(null);
  const rafRef = useRef<number>(0);
  const pendingRef = useRef<{ x: number; y: number } | null>(null);

  const flush = useCallback(() => {
    rafRef.current = 0;
    const el = elRef.current;
    const pt = pendingRef.current;
    if (!el || !pt || disabled) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    // 归一化到 [-1, 1]：左 -1、右 +1；上 -1、下 +1
    const nx = Math.max(-1, Math.min(1, ((pt.x - rect.left) / rect.width) * 2 - 1));
    const ny = Math.max(-1, Math.min(1, ((pt.y - rect.top) / rect.height) * 2 - 1));

    // 按压感方向：鼠标按在卡片上侧（ny < 0）时上侧向屏幕内沉入 -> rotateX < 0；
    // 鼠标按在卡片左侧（nx < 0）时左侧向屏幕内沉入 -> rotateY < 0；
    // 右侧（nx > 0）右侧向屏幕内沉入 -> rotateY > 0；下侧（ny > 0）下侧沉入 -> rotateX > 0。
    // 标准 CSS 3D 左手系（+Z 朝向观察者）：
    //   rotateX(+θ) 让上边向内(-Z)、下边向外(+Z) -> 所以鼠标在上(ny < 0)要 rotateX(+|θ|) = -ny * maxRotate
    //   rotateY(+θ) 让左边向外(+Z)、右边向内(-Z) -> 所以鼠标在右(nx > 0)要 rotateY(+|θ|) = +nx * maxRotate
    //   鼠标在左(nx < 0)要 rotateY(-|θ|) = +nx * maxRotate，使左边向内沉入！
    const rx = -ny * maxRotate;
    const ry = nx * maxRotate;
    // 跟随鼠标的轻微实体偏移
    const tx = nx * maxShift;
    const ty = ny * maxShift;
    // 投影反向微移，拉出离屏悬浮立体感
    const sx = -nx * shadowShift;
    const sy = -ny * shadowShift;

    const mx = ((nx + 1) * 50).toFixed(2);
    const my = ((ny + 1) * 50).toFixed(2);
    // 随倾斜法线偏移的平行掠射光角度（~108°–152°）与扫光位移（-38%..+38%），模拟硬质暗面玻璃扫过环境光
    const glareAngle = (128 + nx * 24 - ny * 14).toFixed(1);
    const glarePos = (50 + nx * 36 + ny * 16).toFixed(1);

    el.style.setProperty("--tilt-rx", `${rx.toFixed(2)}deg`);
    el.style.setProperty("--tilt-ry", `${ry.toFixed(2)}deg`);
    el.style.setProperty("--tilt-tx", `${tx.toFixed(2)}px`);
    el.style.setProperty("--tilt-ty", `${ty.toFixed(2)}px`);
    el.style.setProperty("--shadow-x", `${sx.toFixed(2)}px`);
    el.style.setProperty("--shadow-y", `${sy.toFixed(2)}px`);
    el.style.setProperty("--mx", `${mx}%`);
    el.style.setProperty("--my", `${my}%`);
    el.style.setProperty("--tilt-angle", `${glareAngle}deg`);
    el.style.setProperty("--tilt-glare", `${glarePos}%`);
    el.setAttribute("data-tilting", "true");
  }, [disabled, maxRotate, maxShift, shadowShift]);

  const cancelAndReset = useCallback(() => {
    if (rafRef.current) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    pendingRef.current = null;
    if (elRef.current) resetVars(elRef.current);
  }, []);

  useEffect(() => {
    if (disabled) cancelAndReset();
  }, [disabled, cancelAndReset]);

  useEffect(() => cancelAndReset, [cancelAndReset]);

  const onPointerMove = useCallback(
    (e: PointerEvent<T>) => {
      if (disabled || e.pointerType !== "mouse" || prefersReducedMotion()) return;
      elRef.current = e.currentTarget;
      pendingRef.current = { x: e.clientX, y: e.clientY };
      if (!rafRef.current) {
        rafRef.current = window.requestAnimationFrame(flush);
      }
    },
    [disabled, flush],
  );

  const onPointerEnter = useCallback(
    (e: PointerEvent<T>) => {
      if (disabled || e.pointerType !== "mouse" || prefersReducedMotion()) return;
      elRef.current = e.currentTarget;
      pendingRef.current = { x: e.clientX, y: e.clientY };
      if (!rafRef.current) {
        rafRef.current = window.requestAnimationFrame(flush);
      }
    },
    [disabled, flush],
  );

  const onPointerDown = useCallback(
    (e: PointerEvent<T>) => {
      if (disabled || e.pointerType !== "mouse" || prefersReducedMotion()) return;
      elRef.current = e.currentTarget;
      e.currentTarget.setAttribute("data-pressed", "true");
    },
    [disabled],
  );

  const onPointerUp = useCallback((e: PointerEvent<T>) => {
    e.currentTarget.removeAttribute("data-pressed");
  }, []);

  const onPointerLeave = useCallback(() => {
    cancelAndReset();
  }, [cancelAndReset]);

  const onPointerCancel = useCallback(() => {
    cancelAndReset();
  }, [cancelAndReset]);

  return {
    onPointerEnter,
    onPointerMove,
    onPointerDown,
    onPointerUp,
    onPointerLeave,
    onPointerCancel,
  };
}
