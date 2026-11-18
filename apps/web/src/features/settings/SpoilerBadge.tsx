import { useNarrativePrefs } from "./prefs";
import styles from "./settings.module.css";

/** 剧透调试视图开没开：仅由浏览器本地「显示剧透」开关控制 */
export function useSpoilerView(): { readonly open: boolean } {
  const { spoilers } = useNarrativePrefs();
  return { open: spoilers };
}

/** 剧透调试视图打开时，屏幕顶部常驻一个标记 */
export function SpoilerBadge() {
  const { open } = useSpoilerView();
  if (!open) return null;
  return (
    <div className={styles.spoilerBadge} role="status">
      剧透
    </div>
  );
}
