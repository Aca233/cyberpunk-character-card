import { type NarrativePrefs, setNarrativePref, useNarrativePrefs } from "./prefs";
import styles from "./settings.module.css";

const OPTIONS: readonly [keyof NarrativePrefs, string, string][] = [
  ["sceneTitles", "场景标题卡", "每个场景开头打出一行：城区 · 地点 · 时间"],
  ["closeups", "特写卡", "接到大单、首领现身、拿到不朽物品时弹一张特写；每个场景最多一张"],
  [
    "spoilers",
    "显示剧透",
    "打开后能用上下文查看器和「存为评测用例」，会看到人物的诉求、底线、秘密和委托的隐藏信息；打开期间屏幕顶部一直标着「剧透」",
  ],
];

/** 叙事偏好：存在这台浏览器里，换设备要重新选 */
export function NarrativeSettings() {
  const prefs = useNarrativePrefs();
  return (
    <div className={styles.prefs}>
      <p className={styles.dim}>这些偏好只存在这台浏览器里，默认都关着。</p>
      {OPTIONS.map(([key, label, hint]) => (
        <label key={key} className={styles.pref}>
          <input
            type="checkbox"
            checked={prefs[key]}
            onChange={(e) => setNarrativePref(key, e.target.checked)}
          />
          <span>{label}</span>
          <small className={styles.dim}>{hint}</small>
        </label>
      ))}
    </div>
  );
}
