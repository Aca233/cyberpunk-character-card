import type { OffscreenPace } from "@cp/core";
import type { ReactNode } from "react";
import { Asset, cssUrl, NineSlice } from "../../ui/Asset";
import { FrameBox } from "../../ui/FrameBox";
import { ToggleCheck } from "../../ui/ToggleCheck";
import ms from "./model-settings.module.css";
import {
  type NarrativeToggle,
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

/** 开关分两组：剧情里看得到的呈现，和只给调试用的剧透 */
const SHOW: readonly [NarrativeToggle, string, string][] = [
  ["sceneTitles", "场景标题卡", "城区 · 地点 · 时间 · 天气"],
];

const DEBUG: readonly [NarrativeToggle, string, string][] = [
  ["spoilers", "显示剧透", "人物隐藏动机与城市暗线"],
];

/**
 * 叙事偏好：存在这台浏览器里，换设备要重新选。
 * 版式统一使用原作 notify.itemCell 外框 + 左侧发光标记，控件右对齐
 */
export function NarrativeSettings() {
  const prefs = useNarrativePrefs();
  const toggle = ([key, label, hint]: readonly [NarrativeToggle, string, string]) => (
    <Row key={key} id={`pref-${key}`} label={label} hint={hint}>
      <ToggleCheck
        id={`pref-${key}`}
        variant="switch"
        checked={prefs[key]}
        onChange={(checked) => setNarrativePref(key, checked)}
      />
    </Row>
  );
  return (
    <div className={styles.prefsRoot}>
      <p className={styles.dim}>仅存于本浏览器 · 即时生效</p>

      <section className={styles.prefGroup} aria-label="呈现">
        <NineSlice
          id="notify.itemCellBg"
          slice={30}
          tint="rgb(12 10 18 / 84%)"
          className={styles.slice}
        />
        <NineSlice
          id="notify.itemCellFg"
          slice={30}
          tint="var(--cp-red-dim)"
          className={styles.slice}
        />
        <div className={styles.groupHeader}>
          <Asset id="panel.glowLeft" height={18} tint="var(--cp-cyan)" />
          <span className={ms.kicker}>01 / 呈现</span>
        </div>
        <span
          className={styles.thinLine}
          style={{ maskImage: cssUrl("tab.line"), WebkitMaskImage: cssUrl("tab.line") }}
          aria-hidden
        />
        {SHOW.map(toggle)}
      </section>

      <section className={styles.prefGroup} aria-label="城市节奏">
        <NineSlice
          id="notify.itemCellBg"
          slice={30}
          tint="rgb(12 10 18 / 84%)"
          className={styles.slice}
        />
        <NineSlice
          id="notify.itemCellFg"
          slice={30}
          tint="var(--cp-red-dim)"
          className={styles.slice}
        />
        <div className={styles.groupHeader}>
          <Asset id="panel.glowLeft" height={18} tint="var(--cp-cyan)" />
          <span className={ms.kicker}>02 / 城市节奏</span>
        </div>
        <span
          className={styles.thinLine}
          style={{ maskImage: cssUrl("tab.line"), WebkitMaskImage: cssUrl("tab.line") }}
          aria-hidden
        />
        <Row id="pref-offscreen" label="城里的动静" hint="你不在场时城里的城市运转与人物动向">
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
      </section>

      <section className={styles.prefGroup} aria-label="调试">
        <NineSlice
          id="notify.itemCellBg"
          slice={30}
          tint="rgb(12 10 18 / 84%)"
          className={styles.slice}
        />
        <NineSlice
          id="notify.itemCellFg"
          slice={30}
          tint="var(--cp-yellow)"
          className={styles.slice}
        />
        <div className={styles.groupHeader}>
          <Asset id="panel.glowLeft" height={18} tint="var(--cp-yellow)" />
          <span className={ms.kicker}>03 / 调试</span>
        </div>
        <span
          className={styles.thinLine}
          style={{ maskImage: cssUrl("tab.line"), WebkitMaskImage: cssUrl("tab.line") }}
          aria-hidden
        />
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
