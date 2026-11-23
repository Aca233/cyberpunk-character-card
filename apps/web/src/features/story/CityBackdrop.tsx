import { useEffect, useRef, useState } from "react";
import { type AssetId, assetUrl } from "../../assets";
import { isUrlPreloaded, preloadAsset } from "../../assets/preload";
import { cssUrl } from "../../ui/Asset";
import { useNarrativePrefs } from "../settings/prefs";
import {
  BackdropFxCanvas,
  getThemeVideoTime,
  rememberThemeVideoTime,
  type ShellThemeId,
  themeById,
  useReducedMotion,
  useShellTheme,
} from "../theme";
import { type BackdropQuery, backdropOf } from "./art";
import styles from "./story.module.css";

/**
 * 正文背后的夜之城（用户定的，2026-11-02："H10 全景当正文背景"）：
 * 压暗、偏冷，正文那一列再压暗一层，字不受影响；慢慢推近，不拦截点击。
 * 按当前地点与时段切换对应原作实景图，切换前预加载并解码后做淡入过渡，未匹配地点回退 menu.nightCity。
 * 当用户在设置中开启「局内应用界面主题」且当前选用了动态主题时，在保持中央阅读遮罩的前提下播放主题动态壁纸，
 * 并完整挂载鼠标阻尼视差、镜头缓呼吸、主题粒子雨幕/星尘 Canvas 与极细全息扫线动效。
 */
export function CityBackdrop(query: BackdropQuery) {
  const { storyTheme } = useNarrativePrefs();
  const { effectiveId, entries } = useShellTheme();
  const reducedMotion = useReducedMotion();
  const spec = themeById(effectiveId);
  const entry = entries[effectiveId];
  const useThemeMedia = storyTheme && effectiveId !== "night-city" && spec.media !== undefined;
  const fxTheme: ShellThemeId = useThemeMedia ? effectiveId : "night-city";

  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [readySrc, setReadySrc] = useState<string | null>(null);

  const videoSrc =
    !useThemeMedia || reducedMotion
      ? undefined
      : spec.downloadable
        ? entry.status === "cached"
          ? entry.objectUrl
          : undefined
        : spec.media?.videoUrl;

  const videoReady = videoSrc !== undefined && readySrc === videoSrc;

  // 局内鼠标轻微视差景深：带阻尼插值，不抢正文注意力，页面隐藏或减动效时自动停止
  useEffect(() => {
    const el = rootRef.current;
    if (!el || reducedMotion) return;
    const rangeX = 11;
    const rangeY = 7;
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
  }, [reducedMotion]);

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
          // 自动播放策略受限时保留高清静态封面
        });
    }
    return () => {
      rememberThemeVideoTime(effectiveId, video.currentTime);
    };
  }, [effectiveId, videoSrc]);

  const target = backdropOf(query);
  const targetUrl = assetUrl(target);
  const [layer, setLayer] = useState<{ active: AssetId; prev: AssetId | null }>({
    active: target,
    prev: null,
  });

  useEffect(() => {
    if (target === layer.active) return;
    const commit = () => {
      setLayer((cur) => (cur.active === target ? cur : { active: target, prev: cur.active }));
    };
    if (!targetUrl || isUrlPreloaded(targetUrl)) {
      commit();
      return;
    }
    let cancelled = false;
    void preloadAsset(target, "high", { decode: true }).then(() => {
      if (!cancelled) commit();
    });
    return () => {
      cancelled = true;
    };
  }, [target, targetUrl, layer.active]);

  useEffect(() => {
    if (layer.prev === null) return;
    const timer = window.setTimeout(() => {
      setLayer((cur) => (cur.prev === null ? cur : { active: cur.active, prev: null }));
    }, 950);
    return () => window.clearTimeout(timer);
  }, [layer.prev]);

  const activeBg = cssUrl(layer.active) ?? cssUrl("menu.nightCity");
  const prevBg = layer.prev ? cssUrl(layer.prev) : undefined;

  return (
    <div
      ref={rootRef}
      className={styles.city}
      data-story-theme={useThemeMedia ? effectiveId : undefined}
      aria-hidden
    >
      <div className={styles.cityStage}>
        {useThemeMedia && spec.media ? (
          <>
            <span
              className={styles.cityThemePoster}
              style={{ backgroundImage: `url("${spec.media.posterUrl}")` }}
            />
            {videoSrc && (
              <video
                ref={videoRef}
                className={styles.cityThemeVideo}
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
          <>
            {prevBg && (
              <span
                key={`prev-${layer.prev}`}
                className={styles.cityImage}
                style={{ backgroundImage: prevBg }}
              />
            )}
            {activeBg && (
              <span
                key={`active-${layer.active}`}
                className={
                  layer.prev ? `${styles.cityImage} ${styles.cityImageEnter}` : styles.cityImage
                }
                style={{ backgroundImage: activeBg }}
              />
            )}
          </>
        )}
      </div>

      {!reducedMotion && (
        <BackdropFxCanvas theme={fxTheme} intense={false} className={styles.cityFxCanvas} />
      )}
      {!reducedMotion && <span className={styles.cityScanBeam} />}
    </div>
  );
}
