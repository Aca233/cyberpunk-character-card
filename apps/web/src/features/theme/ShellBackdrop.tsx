import { useEffect, useRef, useState } from "react";
import { cssUrl, NineSlice } from "../../ui/Asset";
import { BackdropFxCanvas } from "./BackdropFxCanvas";
import { type ShellThemeId, themeById } from "./catalog";
import styles from "./shell-backdrop.module.css";
import { useShellTheme } from "./store";

/** 原作 panel.frame（1060×1560）：切角和侧边缺口都在离边 120 原图像素以内，按 120 切 */
const FRAME_SLICE = 120;

export type ShellBackdropVariant = "menu" | "settings" | "characters" | "workshop";

/** 跨路由保留视频播放进度，主菜单 / 设置 / 角色工作台 / 局内剧情之间切换时动态壁纸无缝续播 */
const videoTimeMemory = new Map<ShellThemeId, number>();

export function getThemeVideoTime(id: ShellThemeId): number | undefined {
  return videoTimeMemory.get(id);
}

export function rememberThemeVideoTime(id: ShellThemeId, time: number): void {
  if (Number.isFinite(time) && time > 0) {
    videoTimeMemory.set(id, time);
  }
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false,
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}

/**
 * 外壳界面共享背景层：供主菜单、设置页与角色工作台共用。
 * 默认「夜之城 2091」保持原有静态实景与条幅；
 * 已缓存的动态主题（「月球舷窗」等）播放本地 IndexedDB 缓存的 4K 视频，并在首帧前及减动效模式下以轻量封面兜底。
 */
export function ShellBackdrop({ variant }: { readonly variant: ShellBackdropVariant }) {
  const { effectiveId, entries } = useShellTheme();
  const spec = themeById(effectiveId);
  const entry = entries[effectiveId];
  const reducedMotion = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [readySrc, setReadySrc] = useState<string | null>(null);

  const videoSrc = reducedMotion
    ? undefined
    : spec.downloadable
      ? entry.status === "cached"
        ? entry.objectUrl
        : undefined
      : spec.media?.videoUrl;

  const videoReady = videoSrc !== undefined && readySrc === videoSrc;

  // 鼠标轻微视差景深：带阻尼插值，不生硬抢眼，并在页面隐藏或减动效时自动关闭
  useEffect(() => {
    const el = rootRef.current;
    if (!el || reducedMotion) return;
    const rangeX = variant === "menu" ? 14 : 7;
    const rangeY = variant === "menu" ? 9 : 4.5;
    let targetX = 0;
    let targetY = 0;
    let curX = 0;
    let curY = 0;
    let raf = 0;

    const tick = () => {
      raf = 0;
      if (document.hidden) return;
      curX += (targetX - curX) * 0.08;
      curY += (targetY - curY) * 0.08;
      el.style.setProperty("--bg-px", `${curX.toFixed(2)}px`);
      el.style.setProperty("--bg-py", `${curY.toFixed(2)}px`);
      if (Math.abs(targetX - curX) > 0.06 || Math.abs(targetY - curY) > 0.06) {
        raf = requestAnimationFrame(tick);
      }
    };

    const schedule = () => {
      if (raf === 0 && !document.hidden) {
        raf = requestAnimationFrame(tick);
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const nx = event.clientX / Math.max(1, window.innerWidth) - 0.5;
      const ny = event.clientY / Math.max(1, window.innerHeight) - 0.5;
      targetX = -nx * 2 * rangeX;
      targetY = -ny * 2 * rangeY;
      schedule();
    };

    const onPointerLeave = () => {
      targetX = 0;
      targetY = 0;
      schedule();
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.documentElement.addEventListener("mouseleave", onPointerLeave);
    return () => {
      if (raf !== 0) cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onPointerMove);
      document.documentElement.removeEventListener("mouseleave", onPointerLeave);
      el.style.removeProperty("--bg-px");
      el.style.removeProperty("--bg-py");
    };
  }, [variant, reducedMotion]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoSrc) return;
    if (video.readyState >= 2) {
      setReadySrc(videoSrc);
    }
    const playPromise = video.play();
    if (playPromise) {
      playPromise
        .then(() => {
          setReadySrc(videoSrc);
        })
        .catch(() => {
          // 自动播放策略受限时保留高清静态封面，不报错
        });
    }
    return () => {
      rememberThemeVideoTime(effectiveId, video.currentTime);
    };
  }, [effectiveId, videoSrc]);

  const showStrip = variant === "menu" && effectiveId === "night-city";
  const showGrid = variant !== "characters" && variant !== "workshop";

  return (
    <div
      ref={rootRef}
      className={styles.backdrop}
      data-shell-backdrop
      data-variant={variant}
      data-theme={effectiveId}
      aria-hidden
    >
      <div className={styles.mediaStage}>
        {spec.media ? (
          <>
            <span
              className={styles.poster}
              style={{ backgroundImage: `url("${spec.media.posterUrl}")` }}
            />
            {videoSrc && (
              <video
                ref={videoRef}
                className={styles.video}
                data-ready={videoReady || undefined}
                src={videoSrc}
                poster={spec.media.posterUrl}
                autoPlay
                loop
                muted
                playsInline
                preload="auto"
                disablePictureInPicture
                onLoadedMetadata={(event) => {
                  const saved = getThemeVideoTime(effectiveId);
                  const el = event.currentTarget;
                  if (saved !== undefined && Number.isFinite(el.duration) && el.duration > 1) {
                    el.currentTime = saved % el.duration;
                  }
                }}
                onLoadedData={() => setReadySrc(videoSrc)}
                onCanPlay={() => setReadySrc(videoSrc)}
                onPlaying={() => setReadySrc(videoSrc)}
              />
            )}
          </>
        ) : (
          <span className={styles.bg} style={{ backgroundImage: cssUrl("menu.nightCity") }} />
        )}
      </div>

      <span className={styles.shade} />

      {!reducedMotion && (
        <BackdropFxCanvas
          theme={effectiveId}
          intense={variant === "menu"}
          className={styles.fxCanvas}
        />
      )}

      {showStrip && (
        <span className={styles.strip} style={{ backgroundImage: cssUrl("menu.background") }} />
      )}

      {showGrid && (
        <span className={styles.gridTex} style={{ backgroundImage: cssUrl("fx.grid") }} />
      )}

      <span className={styles.scan} style={{ backgroundImage: cssUrl("fx.scanlines") }} />
      {!reducedMotion && <span className={styles.scanBeam} />}

      <NineSlice
        id="panel.frame"
        tint="var(--cp-red)"
        slice={FRAME_SLICE}
        className={styles.frame}
      />
    </div>
  );
}
