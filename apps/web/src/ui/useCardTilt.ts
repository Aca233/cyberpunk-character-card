import { type PointerEvent, useCallback, useEffect, useRef } from "react";

/**
 * 赛博卡片微幅 3D 原地按压倾斜 + 光学掠射高光系统（零重渲染，帧率无关 rAF 阻尼插值）。
 *
 * 物理直觉（原地按压，不滑移不跳变）：
 * - 鼠标移到卡片任意位置时，光标所在侧向屏内轻压、对侧微抬，卡片严格原地枢转（不做 X/Y 位移滑移）。
 * - 按卡片实际像素宽高与长宽比自适应收敛倾角，并封顶边缘 Z 轴景深（5px），窄卡、扁条与大卡观感一致稳重。
 * - 进入、移动、按压与离开均由 rAF 指数阻尼平滑插值，收敛后自动停帧，零瞬跳、零 CSS 过渡打架、零闲置开销。
 * - 展开（disabled=true）或 prefers-reduced-motion: reduce 时立即归零，保证阅读与滚动绝对平稳。
 */
export interface CardTiltOptions {
  /** 禁用（例如 HUD 角块展开时归正，不倾斜） */
  readonly disabled?: boolean;
  /** 标准卡片最大俯仰角（度），默认 2.6；窄卡/扁条/大卡按尺寸自动收敛 */
  readonly maxRotate?: number;
  /** 阴影反向微视差（px），默认 2.5 */
  readonly shadowShift?: number;
}

/** 参考标准卡片边长（px）：短于该尺寸的轴按比例收敛倾角 */
const REF_AXIS_PX = 160;
/** 垂直短轴稳定基准（px）：抑制扁长条/细竖条的梯形透视畸变 */
const STAB_AXIS_PX = 140;
/** 边缘最大 Z 轴景深（px）：保持细腻微 3D，文字清晰不变形 */
const MAX_EDGE_Z_PX = 5;
/** 按下瞬间在当前倾角基础上的轻微加深倍率 */
const PRESS_DEPTH_MULT = 1.2;

const DEFAULT_GLARE_ANGLE = 126;
const DEFAULT_GLARE_POS = 50;

function edgeCapDeg(lengthPx: number): number {
  return (Math.atan2(MAX_EDGE_Z_PX, Math.max(lengthPx, 1) / 2) * 180) / Math.PI;
}

interface TiltState {
  active: boolean;
  pressed: boolean;
  curRx: number;
  curRy: number;
  curSx: number;
  curSy: number;
  curAngle: number;
  curGlare: number;
  baseRx: number;
  baseRy: number;
  baseSx: number;
  baseSy: number;
  tgtAngle: number;
  tgtGlare: number;
  lastTs: number;
}

function createTiltState(): TiltState {
  return {
    active: false,
    pressed: false,
    curRx: 0,
    curRy: 0,
    curSx: 0,
    curSy: 0,
    curAngle: DEFAULT_GLARE_ANGLE,
    curGlare: DEFAULT_GLARE_POS,
    baseRx: 0,
    baseRy: 0,
    baseSx: 0,
    baseSy: 0,
    tgtAngle: DEFAULT_GLARE_ANGLE,
    tgtGlare: DEFAULT_GLARE_POS,
    lastTs: 0,
  };
}

function resetVars(el: HTMLElement) {
  el.style.removeProperty("--tilt-rx");
  el.style.removeProperty("--tilt-ry");
  el.style.removeProperty("--shadow-x");
  el.style.removeProperty("--shadow-y");
  el.style.removeProperty("--tilt-angle");
  el.style.removeProperty("--tilt-glare");
  el.removeAttribute("data-tilting");
  el.removeAttribute("data-glare");
  el.removeAttribute("data-pressed");
}

function applyVars(el: HTMLElement, s: TiltState) {
  el.style.setProperty("--tilt-rx", `${s.curRx.toFixed(3)}deg`);
  el.style.setProperty("--tilt-ry", `${s.curRy.toFixed(3)}deg`);
  el.style.setProperty("--shadow-x", `${s.curSx.toFixed(2)}px`);
  el.style.setProperty("--shadow-y", `${s.curSy.toFixed(2)}px`);
  el.style.setProperty("--tilt-angle", `${s.curAngle.toFixed(1)}deg`);
  el.style.setProperty("--tilt-glare", `${s.curGlare.toFixed(1)}%`);
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function useCardTilt<T extends HTMLElement = HTMLElement>({
  disabled = false,
  maxRotate = 2.6,
  shadowShift = 2.5,
}: CardTiltOptions = {}) {
  const elRef = useRef<T | null>(null);
  const rafRef = useRef<number>(0);
  const stateRef = useRef<TiltState>(createTiltState());

  const stopImmediate = useCallback(() => {
    if (rafRef.current) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    stateRef.current = createTiltState();
    if (elRef.current) resetVars(elRef.current);
  }, []);

  const step = useCallback(
    (now: number) => {
      rafRef.current = 0;
      const el = elRef.current;
      const s = stateRef.current;
      if (!el || disabled) {
        if (el) resetVars(el);
        return;
      }

      const dt = s.lastTs > 0 ? Math.min(0.05, Math.max(0.001, (now - s.lastTs) / 1000)) : 1 / 60;
      s.lastTs = now;

      const mult = s.active && s.pressed ? PRESS_DEPTH_MULT : 1;
      const tgtRx = s.active ? s.baseRx * mult : 0;
      const tgtRy = s.active ? s.baseRy * mult : 0;
      const tgtSx = s.active ? s.baseSx * (s.pressed ? 0.35 : 1) : 0;
      const tgtSy = s.active ? s.baseSy * (s.pressed ? 0.35 : 1) : 0;
      const tgtAngle = s.active ? s.tgtAngle : DEFAULT_GLARE_ANGLE;
      const tgtGlare = s.active ? s.tgtGlare : DEFAULT_GLARE_POS;

      // 帧率无关指数平滑：进入/跟手利落顺滑，离开舒缓回平
      const speed = s.active ? 18 : 14;
      const alpha = 1 - Math.exp(-speed * dt);

      s.curRx += (tgtRx - s.curRx) * alpha;
      s.curRy += (tgtRy - s.curRy) * alpha;
      s.curSx += (tgtSx - s.curSx) * alpha;
      s.curSy += (tgtSy - s.curSy) * alpha;
      s.curAngle += (tgtAngle - s.curAngle) * alpha;
      s.curGlare += (tgtGlare - s.curGlare) * alpha;

      const settled =
        Math.abs(tgtRx - s.curRx) < 0.006 &&
        Math.abs(tgtRy - s.curRy) < 0.006 &&
        Math.abs(tgtSx - s.curSx) < 0.015 &&
        Math.abs(tgtSy - s.curSy) < 0.015 &&
        Math.abs(tgtGlare - s.curGlare) < 0.08;

      if (settled) {
        if (!s.active) {
          stateRef.current = createTiltState();
          resetVars(el);
          return;
        }
        s.curRx = tgtRx;
        s.curRy = tgtRy;
        s.curSx = tgtSx;
        s.curSy = tgtSy;
        s.curAngle = tgtAngle;
        s.curGlare = tgtGlare;
        s.lastTs = 0;
        applyVars(el, s);
        return;
      }

      applyVars(el, s);
      rafRef.current = window.requestAnimationFrame(step);
    },
    [disabled],
  );

  const ensureLoop = useCallback(() => {
    if (!rafRef.current) {
      stateRef.current.lastTs = 0;
      rafRef.current = window.requestAnimationFrame(step);
    }
  }, [step]);

  const updateTarget = useCallback(
    (el: T, clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      if (w <= 0 || h <= 0) return;

      // 归一化到 [-1, 1]：左 -1、右 +1；上 -1、下 +1
      const nx = Math.max(-1, Math.min(1, ((clientX - rect.left) / w) * 2 - 1));
      const ny = Math.max(-1, Math.min(1, ((clientY - rect.top) / h) * 2 - 1));

      const wDamp = Math.min(1, w / REF_AXIS_PX);
      const hDamp = Math.min(1, h / REF_AXIS_PX);
      const wStab = Math.min(1, Math.sqrt(w / STAB_AXIS_PX));
      const hStab = Math.min(1, Math.sqrt(h / STAB_AXIS_PX));

      const rxMax = Math.min(maxRotate * hDamp * wStab, edgeCapDeg(h));
      const ryMax = Math.min(maxRotate * wDamp * hStab, edgeCapDeg(w));

      const sxMax = Math.min(shadowShift, w * 0.01);
      const syMax = Math.min(shadowShift, h * 0.014);

      const s = stateRef.current;
      s.active = true;
      // 标准 CSS 3D 左手系（+Z 朝向观察者）：光标压在哪一侧，那一侧向屏内微沉
      s.baseRx = -ny * rxMax;
      s.baseRy = nx * ryMax;
      s.baseSx = -nx * sxMax;
      s.baseSy = -ny * syMax;
      s.tgtAngle = DEFAULT_GLARE_ANGLE + nx * 14 - ny * 8;
      s.tgtGlare = DEFAULT_GLARE_POS + nx * 26 + ny * 12;

      el.setAttribute("data-tilting", "true");
      el.setAttribute("data-glare", "true");
      ensureLoop();
    },
    [ensureLoop, maxRotate, shadowShift],
  );

  useEffect(() => {
    if (disabled) stopImmediate();
  }, [disabled, stopImmediate]);

  useEffect(() => stopImmediate, [stopImmediate]);

  const onPointerEnter = useCallback(
    (e: PointerEvent<T>) => {
      if (disabled || e.pointerType !== "mouse" || prefersReducedMotion()) return;
      elRef.current = e.currentTarget;
      updateTarget(e.currentTarget, e.clientX, e.clientY);
    },
    [disabled, updateTarget],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent<T>) => {
      if (disabled || e.pointerType !== "mouse" || prefersReducedMotion()) return;
      elRef.current = e.currentTarget;
      updateTarget(e.currentTarget, e.clientX, e.clientY);
    },
    [disabled, updateTarget],
  );

  const onPointerDown = useCallback(
    (e: PointerEvent<T>) => {
      if (disabled || e.pointerType !== "mouse" || prefersReducedMotion()) return;
      elRef.current = e.currentTarget;
      stateRef.current.pressed = true;
      e.currentTarget.setAttribute("data-pressed", "true");
      ensureLoop();
    },
    [disabled, ensureLoop],
  );

  const onPointerUp = useCallback(
    (e: PointerEvent<T>) => {
      stateRef.current.pressed = false;
      e.currentTarget.removeAttribute("data-pressed");
      if (stateRef.current.active) ensureLoop();
    },
    [ensureLoop],
  );

  const onPointerLeave = useCallback(() => {
    const s = stateRef.current;
    s.active = false;
    s.pressed = false;
    if (elRef.current) {
      elRef.current.removeAttribute("data-glare");
      elRef.current.removeAttribute("data-pressed");
      ensureLoop();
    }
  }, [ensureLoop]);

  const onPointerCancel = useCallback(() => {
    stopImmediate();
  }, [stopImmediate]);

  return {
    onPointerEnter,
    onPointerMove,
    onPointerDown,
    onPointerUp,
    onPointerLeave,
    onPointerCancel,
  };
}
