import type { Ref } from "react";
import { playSfx } from "../audio";
import { Asset } from "./Asset";
import styles from "./menuitem.module.css";

interface MenuItemProps {
  readonly label: string;
  readonly hint?: string | undefined;
  readonly hintTone?: "dim" | "cyan" | "warn" | undefined;
  readonly selected?: boolean;
  readonly disabled?: boolean;
  /** 不能选时的原因，悬停显示 */
  readonly reason?: string | undefined;
  readonly buttonRef?: Ref<HTMLButtonElement> | undefined;
  readonly onSelect: () => void;
  readonly onFocus?: () => void;
}

/**
 * 主菜单项：红色文字，悬停和选中变青色。
 * 左边的标记换成原作菱形格 menu.cell*（用户定的换框对照表，计划第十二节第 9 条）：
 * 平时只有描边 menu.cellBorder，悬停和选中时叠上实心 menu.cellFill，和竖条托架区分开
 */
export function MenuItem({
  label,
  hint,
  hintTone = "dim",
  selected,
  disabled,
  reason,
  buttonRef,
  onSelect,
  onFocus,
}: MenuItemProps) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className={styles.item}
      data-selected={selected || undefined}
      disabled={disabled}
      title={disabled ? reason : undefined}
      onClick={() => {
        if (!disabled) playSfx("confirm");
        onSelect();
      }}
      onMouseEnter={() => {
        if (!disabled) playSfx("hover");
        onFocus?.();
      }}
      onFocus={onFocus}
    >
      <span className={styles.mark} aria-hidden>
        <Asset id="menu.cellBorder" height={20} tint="currentColor" />
        <Asset id="menu.cellFill" height={20} tint="currentColor" className={styles.markFill} />
      </span>
      <span className={styles.label}>{label}</span>
      {hint !== undefined && (
        <span className={styles.hint} data-tone={hintTone}>
          {hint}
        </span>
      )}
    </button>
  );
}
