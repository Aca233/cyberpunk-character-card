import type { ReactNode } from "react";
import { NineSlice } from "./Asset";
import styles from "./actionbutton.module.css";

interface ActionButtonProps {
  readonly children: ReactNode;
  readonly onClick?: (() => void) | undefined;
  readonly disabled?: boolean | undefined;
  /** 悬停提示 */
  readonly title?: string | undefined;
  /** 按钮上只有符号时的无障碍名字 */
  readonly label?: string | undefined;
  /** 展开类按钮：传了就带 aria-expanded */
  readonly expanded?: boolean | undefined;
}

/** 列表行里的小按钮：底是原作标签页底（和 Button 同一张 tab.bg），青色、字号小 */
export function ActionButton({
  children,
  onClick,
  disabled,
  title,
  label,
  expanded,
}: ActionButtonProps) {
  return (
    <button
      type="button"
      className={styles.action}
      aria-label={label}
      aria-expanded={expanded}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      <NineSlice id="tab.bg" tint="currentColor" slice={14} className={styles.bg} />
      {children}
    </button>
  );
}
