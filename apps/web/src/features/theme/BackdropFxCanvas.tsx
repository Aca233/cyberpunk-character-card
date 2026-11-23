import { useEffect, useRef } from "react";
import type { ShellThemeId } from "./catalog";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  len: number;
  alpha: number;
  phase: number;
  speed: number;
  color: string;
  angle: number;
  spin: number;
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)] as T;
}

function makeParticle(theme: ShellThemeId, w: number, h: number, randomY: boolean): Particle {
  const x = Math.random() * w;
  const y = randomY ? Math.random() * h : theme === "rain-window" ? -20 : h + 16;

  if (theme === "rain-window") {
    const isDrop = Math.random() < 0.78;
    return {
      x,
      y,
      vx: isDrop ? -1.4 - Math.random() * 1.1 : (Math.random() - 0.5) * 0.25,
      vy: isDrop ? 9.5 + Math.random() * 7.5 : -0.35 - Math.random() * 0.4,
      size: isDrop ? 0.9 + Math.random() * 0.7 : 1.4 + Math.random() * 2.2,
      len: isDrop ? 16 + Math.random() * 26 : 0,
      alpha: isDrop ? 0.14 + Math.random() * 0.2 : 0.16 + Math.random() * 0.24,
      phase: Math.random() * Math.PI * 2,
      speed: 0.015 + Math.random() * 0.02,
      color: pick(["110, 247, 255", "120, 184, 255", "220, 244, 255"]),
      angle: 0,
      spin: 0,
    };
  }

  if (theme === "lunar-porthole") {
    const isPetal = Math.random() < 0.38;
    return {
      x,
      y,
      vx: (Math.random() - 0.5) * 0.45,
      vy: -(0.22 + Math.random() * 0.45),
      size: isPetal ? 3.2 + Math.random() * 3.8 : 1.1 + Math.random() * 2.1,
      len: isPetal ? 1 : 0,
      alpha: isPetal ? 0.28 + Math.random() * 0.34 : 0.18 + Math.random() * 0.32,
      phase: Math.random() * Math.PI * 2,
      speed: 0.014 + Math.random() * 0.022,
      color: isPetal
        ? pick(["255, 226, 112", "255, 244, 196"])
        : pick(["183, 148, 255", "124, 242, 255", "255, 226, 112"]),
      angle: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.028,
    };
  }

  if (theme === "moon-helmet") {
    return {
      x,
      y,
      vx: (Math.random() - 0.5) * 0.32,
      vy: -(0.18 + Math.random() * 0.38),
      size: 1.2 + Math.random() * 3.0,
      len: 0,
      alpha: 0.16 + Math.random() * 0.32,
      phase: Math.random() * Math.PI * 2,
      speed: 0.012 + Math.random() * 0.02,
      color: pick(["142, 197, 255", "114, 246, 255", "252, 238, 10", "240, 248, 255"]),
      angle: 0,
      spin: 0,
    };
  }

  // night-city：赛博红/青/黄微尘与轻微上升气流
  return {
    x,
    y,
    vx: (Math.random() - 0.5) * 0.4,
    vy: -(0.25 + Math.random() * 0.5),
    size: 1.1 + Math.random() * 2.2,
    len: 0,
    alpha: 0.14 + Math.random() * 0.26,
    phase: Math.random() * Math.PI * 2,
    speed: 0.018 + Math.random() * 0.024,
    color: pick(["255, 97, 88", "94, 246, 255", "252, 238, 10"]),
    angle: 0,
    spin: 0,
  };
}

function particleCountFor(theme: ShellThemeId, intense: boolean): number {
  const base =
    theme === "rain-window"
      ? 54
      : theme === "lunar-porthole"
        ? 44
        : theme === "moon-helmet"
          ? 42
          : 34;
  return intense ? base : Math.round(base * 0.5);
}

/**
 * 主题专属轻量 Canvas 氛围粒子层：
 * - 雨夜窗畔：斜落冷雨丝与霓虹微光尘
 * - 月球舷窗：轻缓上浮的流金光片与星尘
 * - 月面余光：低重力月尘与赛博黄/冰蓝星光点
 * - 夜之城：霓虹微粒漂浮
 * 页面隐藏或系统减动效时自动停止，不占用后台性能。
 */
export function BackdropFxCanvas({
  theme,
  intense,
  className,
}: {
  readonly theme: ShellThemeId;
  readonly intense: boolean;
  readonly className?: string | undefined;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let particles: Particle[] = [];
    let rafId = 0;
    let lastTime = performance.now();

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, Math.floor(rect.width));
      height = Math.max(1, Math.floor(rect.height));
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = particleCountFor(theme, intense);
      particles = Array.from({ length: count }, () => makeParticle(theme, width, height, true));
    };

    resize();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    ro?.observe(canvas);

    const draw = (now: number) => {
      rafId = 0;
      if (document.hidden) return;
      const dt = Math.min(2.2, Math.max(0.4, (now - lastTime) / 16.67));
      lastTime = now;

      ctx.clearRect(0, 0, width, height);

      for (let i = 0; i < particles.length; i += 1) {
        const p = particles[i];
        if (!p) continue;

        p.phase += p.speed * dt;
        p.x += (p.vx + (p.len === 0 ? Math.sin(p.phase) * 0.22 : 0)) * dt;
        p.y += p.vy * dt;
        p.angle += p.spin * dt;

        if (theme === "rain-window" && p.len > 0) {
          if (p.y - p.len > height + 24 || p.x < -40) {
            particles[i] = makeParticle(theme, width, height, false);
            continue;
          }
          ctx.strokeStyle = `rgba(${p.color}, ${p.alpha})`;
          ctx.lineWidth = p.size;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 2.1, p.y - p.len);
          ctx.stroke();
          continue;
        }

        if (p.y < -24 || p.y > height + 24 || p.x < -32 || p.x > width + 32) {
          particles[i] = makeParticle(theme, width, height, false);
          continue;
        }

        const twinkle = 0.6 + 0.4 * Math.sin(p.phase * 1.4);
        const alpha = p.alpha * twinkle;

        if (theme === "lunar-porthole" && p.len === 1) {
          // 菱形/折纸流金微光片
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.angle);
          ctx.fillStyle = `rgba(${p.color}, ${alpha})`;
          ctx.beginPath();
          ctx.moveTo(0, -p.size);
          ctx.lineTo(p.size * 0.62, 0);
          ctx.lineTo(0, p.size * 0.72);
          ctx.lineTo(-p.size * 0.62, 0);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
          continue;
        }

        ctx.fillStyle = `rgba(${p.color}, ${alpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }

      rafId = requestAnimationFrame(draw);
    };

    const start = () => {
      if (rafId !== 0 || document.hidden) return;
      lastTime = performance.now();
      rafId = requestAnimationFrame(draw);
    };

    const onVisibility = () => {
      if (document.hidden) {
        if (rafId !== 0) {
          cancelAnimationFrame(rafId);
          rafId = 0;
        }
      } else {
        start();
      }
    };

    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (rafId !== 0) cancelAnimationFrame(rafId);
      ro?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [theme, intense]);

  return <canvas ref={canvasRef} className={className} aria-hidden />;
}
