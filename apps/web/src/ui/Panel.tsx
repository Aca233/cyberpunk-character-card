import type { ReactNode } from "react";
import { NineSlice } from "./Asset";
import styles from "./panel.module.css";

interface PanelProps {
  readonly children: ReactNode;
  /** 边框颜色，默认主界面红 */
  readonly line?: string;
  readonly title?: string;
  readonly className?: string | undefined;
  readonly as?: "section" | "div" | "aside";
  /**
   * 大页外框（用户定的换框对照表，计划第十二节第 9 条）：日志、商店、义体医生这类弹出大页，
   * 框换成原作 panel.frame 红色细线切角框，和普通面板的物品格框区分开；底照旧是物品格的底
   */
  readonly frame?: boolean;
  /** 夹在底板与框线之间的自定义表层（如卡片材质/掠射反光，确保不压过框线与文字） */
  readonly surface?: ReactNode;
  /** 叠在框线之上、文字之下的动态边框特效层（同形九宫格蒙版流光，pointer-events: none） */
  readonly borderFx?: ReactNode;
}

/** 原作 panel.frame（1060×1560）：切角和侧边缺口都在离边 120 原图像素以内，按 120 切 */
const FRAME_SLICE = 120;

/**
 * 原作 notify.itemCell*（204×177，scale 2）：
 * 左侧双竖线在 x=0..30、左侧缺口在 y=121..155、右下 45° 斜切为 46×47；
 * 按 [上16, 右50, 下58, 左36] 切可把缺口与斜切完整留在固定角里，拉伸区无透明破口
 */
export const ITEM_CELL_SLICE = [16, 50, 58, 36] as const;

/** 斜切面板：原作物品格的底和框（右下斜切角、1px 细线），按九宫格拉伸 */
export function Panel({
  children,
  line = "var(--cp-red)",
  title,
  className,
  as: Tag = "section",
  frame = false,
  surface,
  borderFx,
}: PanelProps) {
  return (
    <Tag
      className={[styles.panel, className].filter(Boolean).join(" ")}
      data-frame={frame || undefined}
    >
      <NineSlice
        id="notify.itemCellBg"
        tint="var(--cp-panel)"
        slice={ITEM_CELL_SLICE}
        className={frame ? styles.frameBg : undefined}
      />
      {surface}
      {frame ? (
        <NineSlice id="panel.frame" tint={line} slice={FRAME_SLICE} />
      ) : (
        <NineSlice id="notify.itemCellFg" tint={line} slice={ITEM_CELL_SLICE} />
      )}
      {borderFx}
      {title !== undefined && <h2 className={styles.title}>{title}</h2>}
      <div className={styles.body}>{children}</div>
    </Tag>
  );
}
