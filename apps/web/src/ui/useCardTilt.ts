import { type PointerEvent, useCallback, useEffect, useRef } from "react";

/**
 * 赛博卡片磁吸 3D 按压倾斜 + 鼠标跟随高光系统（零重渲染，走 rAF 写入 CSS 变量）。
 *
 * 物理直觉（尺寸与长宽比自适应按压感）：
 * - 鼠标移到卡片左上角时，左上角向屏内轻压、对侧微抬（rotateX > 0, rotateY < 0），
 *   卡片整体顺着施力方向产生克制的微偏移（--tilt-tx / --tilt-ty），投影轻微反向错位。
 * - 按卡片实际像素宽高自适应衰减：窄条/扁卡自动压低短轴倾角、抑制长轴梯形畸变并限制位移比例，
 *   大卡则封顶边缘 Z 轴景深，确保不同尺寸与长宽比的卡片都稳重自然、不发飘不扭曲。
 * - 鼠标按下（pointerdown）时额外轻压一层（data-pressed），松手回弹。
 * - 展开（disabled=true）或 prefers-reduced-motion: reduce 时自动归零，保证阅读与滚动绝对平稳。
 */
export interface CardTiltOptions {
  /** 禁用（例如 HUD 角块展开时归正，不倾斜） */
  readonly disabled?: boolean;
  /** 标准卡片最大俯仰角（度），默认 5.5；窄卡/大卡会按尺寸自动收敛 */
  readonly maxRotate?: number;
  /** 最大位移偏移量（px），默认 2.5 */
  readonly maxShift?: number;
  /** 阴影反向视差偏移量（px），默认 4.5 */
  readonly shadowShift?: number;
}

/** 参考标准卡片边长（px）：短于该尺寸的轴按比例收敛倾角，避免窄卡灵敏度过高发飘 */
const REF_AXIS_PX = 160;
/** 垂直短轴稳定基准（px）：扁长条/细竖条的另一轴倾角同步柔和收敛，避免梯形透视畸变 */
const STAB_AXIS_PX = 140;
/** 边缘最大 Z 轴景深（px）：防止宽卡在透视下两端变形夸张 */
const MAX_EDGE_Z_PX = 12;

function edgeCapDeg(lengthPx: number): number {
  return (Math.atan2(MAX_EDGE_Z_PX, Math.max(lengthPx, 1) / 2) * 180) / Math.PI;
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
  maxRotate = 5.5,
  maxShift = 2.5,
  shadowShift = 4.5,
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
    const w = rect.width;
    const h = rect.height;
    if (w <= 0 || h <= 0) return;

    // 归一化到 [-1, 1]：左 -1、右 +1；上 -1、下 +1
    const nx = Math.max(-1, Math.min(1, ((pt.x - rect.left) / w) * 2 - 1));
    const ny = Math.max(-1, Math.min(1, ((pt.y - rect.top) / h) * 2 - 1));

    // 按实际宽高自适应计算双轴最大倾角：
    // 1) 短轴衰减（len / 160）避免窄条上下/左右轻划就剧烈翻转；
    // 2) 垂直短轴稳定系数（sqrt(other / 140)）避免扁长条绕长轴偏转时出现尖锐梯形畸变；
    // 3) 边缘景深上限（12px）防止大卡/宽卡边缘透视过重。
    const wDamp = Math.min(1, w / REF_AXIS_PX);
    const hDamp = Math.min(1, h / REF_AXIS_PX);
    const wStab = Math.min(1, Math.sqrt(w / STAB_AXIS_PX));
    const hStab = Math.min(1, Math.sqrt(h / STAB_AXIS_PX));

    const rxMax = Math.min(maxRotate * hDamp * wStab, edgeCapDeg(h));
    const ryMax = Math.min(maxRotate * wDamp * hStab, edgeCapDeg(w));

    // 标准 CSS 3D 左手系（+Z 朝向观察者）：
    // 鼠标按在上侧（ny < 0）上边向内沉入 -> rotateX(+|θ|) = -ny * rxMax
    // 鼠标按在右侧（nx > 0）右边向内沉入 -> rotateY(+|θ|) = +nx * ryMax
    const rx = -ny * rxMax;
    const ry = nx * ryMax;

    // 位移与阴影视差按自身边长比例封顶，窄条不会跳出所在行或脱离阴影
    const txMax = Math.min(maxShift, w * 0.012);
    const tyMax = Math.min(maxShift, h * 0.018);
    const sxMax = Math.min(shadowShift, w * 0.02);
    const syMax = Math.min(shadowShift, h * 0.028);

    const tx = nx * txMax;
    const ty = ny * tyMax;
    const sx = -nx * sxMax;
    const sy = -ny * syMax;

    const mx = ((nx + 1) * 50).toFixed(2);
    const my = ((ny + 1) * 50).toFixed(2);
    // 随倾角柔和滑动的斜向光学玻璃掠射角与高光带位置
    const glareAngle = (126 + nx * 16 - ny * 10).toFixed(1);
    const glarePos = (50 + nx * 30 + ny * 14).toFixed(1);

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
