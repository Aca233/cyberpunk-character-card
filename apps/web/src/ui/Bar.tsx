import { type AssetId, asset } from "../assets";
import { MissingAsset } from "./Asset";
import styles from "./bar.module.css";

interface BarProps {
  readonly id: AssetId;
  readonly value: number;
  readonly max: number;
  readonly color: string;
  readonly width: number;
  readonly label: string;
}

/** 进度条：原作血条蒙版，底色暗、按比例填色；数值变化时宽度过渡 */
export function Bar({ id, value, max, color, width, label }: BarProps) {
  const info = asset(id);
  if (!info) return <MissingAsset id={id} />;
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    // biome-ignore lint/a11y/useSemanticElements: 原生 meter 里放不了血条蒙版的子元素
    <span
      className={styles.bar}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      style={{
        width,
        maxWidth: "100%",
        aspectRatio: `${info.width} / ${info.height}`,
        maskImage: `url("${info.url}")`,
      }}
    >
      <span className={styles.track} style={{ backgroundColor: color }} />
      <span className={styles.fill} style={{ backgroundColor: color, width: `${ratio * 100}%` }} />
    </span>
  );
}

interface CellsProps {
  readonly id: AssetId;
  readonly value: number;
  readonly max: number;
  readonly color: string;
  readonly height: number;
  readonly label: string;
}

/** 格条：RAM 这类按格计的资源 */
export function Cells({ id, value, max, color, height, label }: CellsProps) {
  const info = asset(id);
  if (!info) return <MissingAsset id={id} />;
  const width = (height * info.width) / info.height;
  const mask = `url("${info.url}")`;
  return (
    // biome-ignore lint/a11y/useSemanticElements: 原生 meter 里放不了血条蒙版的子元素
    <span
      className={styles.cells}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
    >
      {Array.from({ length: max }, (_, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: 格子的位置就是它的身份
          key={i}
          className={styles.cell}
          data-on={i < value || undefined}
          style={{ width, height, backgroundColor: color, maskImage: mask }}
        />
      ))}
    </span>
  );
}
