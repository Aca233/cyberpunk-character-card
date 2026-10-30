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
}

/** 原作 panel.frame（1060×1560）：切角和侧边缺口都在离边 120 原图像素以内，按 120 切 */
const FRAME_SLICE = 120;

/** 斜切面板：原作物品格的底和框（右下斜切角、1px 细线），按九宫格拉伸 */
export function Panel({
  children,
  line = "var(--cp-red)",
  title,
  className,
  as: Tag = "section",
  frame = false,
}: PanelProps) {
  return (
    <Tag
      className={[styles.panel, className].filter(Boolean).join(" ")}
      data-frame={frame || undefined}
    >
      <NineSlice
        id="notify.itemCellBg"
        tint="var(--cp-panel)"
        slice={30}
        className={frame ? styles.frameBg : undefined}
      />
      {frame ? (
        <NineSlice id="panel.frame" tint={line} slice={FRAME_SLICE} />
      ) : (
        <NineSlice id="notify.itemCellFg" tint={line} slice={30} />
      )}
      {title !== undefined && <h2 className={styles.title}>{title}</h2>}
      <div className={styles.body}>{children}</div>
    </Tag>
  );
}
