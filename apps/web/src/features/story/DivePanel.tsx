import { Asset, NineSlice } from "../../ui/Asset";
import styles from "./story.module.css";
import { type View, woundTelemetry } from "./view";

const DIVE_SLICE = [20, 20, 30, 30] as const;

/** 潜网深度仪表：融入右侧角块流，采用原作 NineSlice 框体，逐层展示真实深入程度、已确认进展与肉身监护 */
export function DivePanel({
  dive,
  health,
  combat,
}: {
  readonly dive: {
    readonly layer: number;
    readonly layers: number;
    readonly layerLabels: readonly string[];
    readonly chair: string;
    readonly guard: string;
    readonly notes?: readonly string[];
    readonly blackwallVisible?: boolean;
  };
  readonly health: View["health"];
  readonly combat?: View["combat"];
}) {
  const wound = woundTelemetry(health, combat);
  const bodyCritical = wound.tone === "bad" || wound.tone === "dead" || health.condition !== "up";
  const latestNote = dive.notes?.[dive.notes.length - 1];
  return (
    <aside className={styles.divePanel} data-layer="deck" aria-label="潜网深度">
      <NineSlice id="map.panelBg" tint="rgb(6 12 22 / 90%)" slice={DIVE_SLICE} />
      <NineSlice id="map.panelFg" tint="var(--cp-netwatch)" slice={DIVE_SLICE} />
      <div className={styles.diveInner}>
        <header className={styles.diveHead}>
          <span className={styles.diveTitle}>
            <Asset id="interaction.hack" tint="var(--cp-cyan)" height={15} />
            <b>DEEP NET</b>
          </span>
          <span className={styles.diveDepth}>
            L{dive.layer}/{dive.layers}
          </span>
        </header>
        <ol className={styles.diveLayers}>
          {dive.layerLabels.map((label, i) => {
            const here = i + 1 === dive.layer;
            const past = i + 1 < dive.layer;
            return (
              <li
                key={label}
                className={styles.diveLayer}
                data-here={here || undefined}
                data-past={past || undefined}
                data-deep={i >= 2 || undefined}
              >
                <span className={styles.diveIdx}>0{i + 1}</span>
                <span className={styles.diveName}>{label}</span>
                {here && <em className={styles.diveTag}>所在</em>}
              </li>
            );
          })}
          {dive.blackwallVisible && (
            <li
              className={styles.diveLayer}
              data-wall
              title="已装备黑墙协议原型硬件：可侦测并应对涉及黑墙边界的特殊链路"
            >
              <span className={styles.diveIdx}>BW</span>
              <span className={styles.diveName}>黑墙边界（原型响应）</span>
            </li>
          )}
        </ol>
        {latestNote && (
          <div className={styles.diveBody} role="note">
            <div className={styles.diveBodyHead}>
              <small>已确认节点进展</small>
            </div>
            <span>{latestNote}</span>
          </div>
        )}
        <div className={styles.diveBody} data-alert={bodyCritical || undefined} role="status">
          <div className={styles.diveBodyHead}>
            <small>肉身监护</small>
            <b>
              {wound.title}
              {health.condition !== "up" && ` · ${health.conditionLabel}`}
            </b>
          </div>
          <span>
            {dive.chair} · {dive.guard}看守
          </span>
        </div>
      </div>
    </aside>
  );
}
