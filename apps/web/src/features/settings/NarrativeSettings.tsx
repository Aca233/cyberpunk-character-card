import type { OffscreenPace } from "@cp/core";
import {
  type EncounterPace,
  type NarrativeToggle,
  setEncounterPace,
  setNarrativePref,
  setOffscreenPace,
  useNarrativePrefs,
} from "./prefs";
import styles from "./settings.module.css";

const PACES: readonly [OffscreenPace, string][] = [
  ["off", "关"],
  ["slow", "慢（隔 5 场）"],
  ["normal", "常规（隔 3 场）"],
  ["fast", "快（隔 2 场）"],
];

const ENCOUNTERS: readonly [EncounterPace, string][] = [
  ["off", "关"],
  ["rare", "少"],
  ["normal", "常规"],
  ["often", "多"],
];

const OPTIONS: readonly [NarrativeToggle, string, string][] = [
  ["sceneTitles", "场景标题卡", "每个场景开头打出一行：城区 · 地点 · 时间"],
  ["closeups", "特写卡", "接到大单、首领现身、拿到不朽物品时弹一张特写；每个场景最多一张"],
  [
    "breachMatrix",
    "入侵协议矩阵",
    "装了接入仓时，智力检定掷骰前可以先玩原作的代码矩阵：前两段序列各加一档，三段全解开再降一档难度；关着就直接按智力判定",
  ],
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
      <p className={styles.dim}>这些偏好只存在这台浏览器里；开关默认关着。</p>
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
      <label className={styles.pref}>
        <select
          value={prefs.offscreen}
          onChange={(e) => setOffscreenPace(e.target.value as OffscreenPace)}
        >
          {PACES.map(([pace, label]) => (
            <option key={pace} value={pace}>
              {label}
            </option>
          ))}
        </select>
        <span>城里的动静</span>
        <small className={styles.dim}>
          收场时，AI
          推演你没看着的地方：帮派、公司、警察和熟人的动向，之后借新闻、传闻和消息带进故事；隔的场数越少，城里变得越快。游戏时间过了半天也会推演一次
        </small>
      </label>
      <label className={styles.pref}>
        <select
          value={prefs.encounters}
          onChange={(e) => setEncounterPace(e.target.value as EncounterPace)}
        >
          {ENCOUNTERS.map(([pace, label]) => (
            <option key={pace} value={pace}>
              {label}
            </option>
          ))}
        </select>
        <span>路上偶遇</span>
        <small className={styles.dim}>
          在地图上选路线出行、换了城区时，路上碰到事的几率：抢劫、求助、帮派盘查之类，夜里和被警方盯上时更常见；一个场景最多一次。关掉后照样能在正文里自己写
        </small>
      </label>
    </div>
  );
}
