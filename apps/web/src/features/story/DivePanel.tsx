import styles from "./story.module.css";
import { type View, woundTelemetry } from "./view";

/** 潜网：逐层往下的结构图，肉身状态常驻在角落 */
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
  };
  readonly health: View["health"];
  readonly combat?: View["combat"];
}) {
  const wound = woundTelemetry(health, combat);
  return (
    <aside className={styles.divePanel} aria-label="潜网">
      <p className={styles.diveTitle}>
        潜网 · 第 {dive.layer}/{dive.layers} 层
      </p>
      <ol className={styles.diveLayers}>
        {dive.layerLabels.map((label, i) => (
          <li
            key={label}
            className={styles.diveLayer}
            data-here={i + 1 === dive.layer || undefined}
            data-past={i + 1 < dive.layer || undefined}
            data-deep={i >= 2 || undefined}
          >
            <span>{i + 1}</span>
            {label}
          </li>
        ))}
        <li className={styles.diveLayer} data-wall>
          黑墙 · 后面是流窜 AI
        </li>
      </ol>
      <div className={styles.diveBody} role="status">
        <small>肉身</small>
        <b>
          {wound.title}
          {health.condition !== "up" && ` · ${health.conditionLabel}`}
        </b>
        <span>
          躺在{dive.chair}，{dive.guard}守着
        </span>
      </div>
    </aside>
  );
}
