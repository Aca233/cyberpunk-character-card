import { cssUrl } from "../../ui/Asset";
import styles from "./story.module.css";

/**
 * 正文背后的夜之城（用户定的，2026-11-02："H10 全景当正文背景"）：原作主菜单的 bg_nc 全景（menu.nightCity），
 * 压暗、偏冷，正文那一列再压暗一层，字不受影响；慢慢推近，不拦截点击
 */
export function CityBackdrop() {
  return (
    <div className={styles.city} aria-hidden>
      <span className={styles.cityImage} style={{ backgroundImage: cssUrl("menu.nightCity") }} />
    </div>
  );
}
