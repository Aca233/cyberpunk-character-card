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
}

/** 斜切面板：原作物品格的底和框（右下斜切角、1px 细线），按九宫格拉伸 */
export function Panel({
  children,
  line = "var(--cp-red)",
  title,
  className,
  as: Tag = "section",
}: PanelProps) {
  return (
    <Tag className={[styles.panel, className].filter(Boolean).join(" ")}>
      <NineSlice id="notify.itemCellBg" tint="var(--cp-panel)" slice={30} />
      <NineSlice id="notify.itemCellFg" tint={line} slice={30} />
      {title !== undefined && <h2 className={styles.title}>{title}</h2>}
      <div className={styles.body}>{children}</div>
    </Tag>
  );
}
