import { useEffect, useState } from "react";
import { type AssetId, assetUrl } from "../../assets";
import { isUrlPreloaded, preloadAsset } from "../../assets/preload";
import { cssUrl } from "../../ui/Asset";
import { type BackdropQuery, backdropOf } from "./art";
import styles from "./story.module.css";

/**
 * 正文背后的夜之城（用户定的，2026-11-02："H10 全景当正文背景"）：
 * 压暗、偏冷，正文那一列再压暗一层，字不受影响；慢慢推近，不拦截点击。
 * 按当前地点与时段切换对应原作实景图，切换前预加载并解码后做淡入过渡，未匹配地点回退 menu.nightCity
 */
export function CityBackdrop(query: BackdropQuery) {
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
    <div className={styles.city} aria-hidden>
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
          className={layer.prev ? `${styles.cityImage} ${styles.cityImageEnter}` : styles.cityImage}
          style={{ backgroundImage: activeBg }}
        />
      )}
    </div>
  );
}
