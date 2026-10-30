import type { OffscreenPace } from "@cp/core";
import type { ReactNode } from "react";
import { CellFrame, FrameBox } from "../../ui/FrameBox";
import ms from "./model-settings.module.css";
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

/** 开关分两组：剧情里看得到的呈现，和只给调试用的剧透；说明只留一句（设置排版优化：少说明） */
const SHOW: readonly [NarrativeToggle, string, string][] = [
  ["sceneTitles", "场景标题卡", "城区 · 地点 · 时间"],
  ["closeups", "特写卡", "大单、首领、不朽物品，每场最多一张"],
  ["breachMatrix", "入侵协议矩阵", "智力检定前先解代码矩阵（需接入仓）"],
];

const DEBUG: readonly [NarrativeToggle, string, string][] = [
  ["spoilers", "显示剧透", "人物秘密与委托隐藏信息"],
];

/**
 * 叙事偏好：存在这台浏览器里，换设备要重新选。
 * 版式照模型连接页（设置排版优化）：按组排，每项一行，控件放右边
 */
export function NarrativeSettings() {
  const prefs = useNarrativePrefs();
  const toggle = ([key, label, hint]: readonly [NarrativeToggle, string, string]) => (
    <Row key={key} id={`pref-${key}`} label={label} hint={hint}>
      <input
        id={`pref-${key}`}
        type="checkbox"
        checked={prefs[key]}
        onChange={(e) => setNarrativePref(key, e.target.checked)}
      />
    </Row>
  );
  return (
    <div className={ms.root}>
      <p className={styles.dim}>仅存于本浏览器 · 即时生效</p>

      <section className={styles.prefGroup} aria-label="呈现">
        {/* 每组套原作 map.filterCell 框，照模型连接页（用户定的重排） */}
        <CellFrame />
        <span className={ms.kicker}>01 / 呈现</span>
        {SHOW.map(toggle)}
      </section>

      <section className={styles.prefGroup} aria-label="城市节奏">
        <CellFrame />
        <span className={ms.kicker}>02 / 城市节奏</span>
        <Row id="pref-offscreen" label="城里的动静" hint="你不在场时城里的变化">
          <FrameBox>
            <select
              id="pref-offscreen"
              value={prefs.offscreen}
              onChange={(e) => setOffscreenPace(e.target.value as OffscreenPace)}
            >
              {PACES.map(([pace, label]) => (
                <option key={pace} value={pace}>
                  {label}
                </option>
              ))}
            </select>
          </FrameBox>
        </Row>
        <Row id="pref-encounters" label="路上偶遇" hint="换城区时碰到突发事件的几率">
          <FrameBox>
            <select
              id="pref-encounters"
              value={prefs.encounters}
              onChange={(e) => setEncounterPace(e.target.value as EncounterPace)}
            >
              {ENCOUNTERS.map(([pace, label]) => (
                <option key={pace} value={pace}>
                  {label}
                </option>
              ))}
            </select>
          </FrameBox>
        </Row>
      </section>

      <section className={styles.prefGroup} aria-label="调试">
        <CellFrame />
        <span className={ms.kicker}>03 / 调试</span>
        {DEBUG.map(toggle)}
      </section>
    </div>
  );
}

/** 一项偏好：左边名字和一句说明（label 指向控件，点文字也能切换），右边控件 */
function Row({
  id,
  label,
  hint,
  children,
}: {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly children: ReactNode;
}) {
  return (
    <div className={styles.prefRow}>
      <label className={styles.prefText} htmlFor={id}>
        <strong>{label}</strong>
        <small>{hint}</small>
      </label>
      <span className={styles.prefControl}>{children}</span>
    </div>
  );
}
