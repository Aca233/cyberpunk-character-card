import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useNarrativePrefs } from "./prefs";
import styles from "./settings.module.css";

/** 剧透调试视图开没开：手动打开「显示剧透」，或者后端是开发模式 */
export function useSpoilerView(): { readonly open: boolean; readonly dev: boolean } {
  const { spoilers } = useNarrativePrefs();
  const health = useQuery({ queryKey: ["health"], queryFn: api.health });
  const dev = health.data?.dev === true;
  return { open: spoilers || dev, dev };
}

/** 剧透调试视图打开时，屏幕顶部常驻一个标记 */
export function SpoilerBadge() {
  const { spoilers } = useNarrativePrefs();
  const { open } = useSpoilerView();
  if (!open) return null;
  return (
    <div className={styles.spoilerBadge} role="status">
      剧透{spoilers ? "" : "（开发模式）"}
    </div>
  );
}
