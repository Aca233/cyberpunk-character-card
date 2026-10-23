import { Asset } from "./Asset";
import styles from "./menuitem.module.css";

interface MenuItemProps {
  readonly label: string;
  readonly hint?: string | undefined;
  readonly selected?: boolean;
  readonly disabled?: boolean;
  /** 不能选时的原因，悬停显示 */
  readonly reason?: string | undefined;
  readonly onSelect: () => void;
  readonly onFocus?: () => void;
}

/** 主菜单项：红色文字，悬停和选中变青色，选中时左侧竖条 */
export function MenuItem({
  label,
  hint,
  selected,
  disabled,
  reason,
  onSelect,
  onFocus,
}: MenuItemProps) {
  return (
    <button
      type="button"
      className={styles.item}
      data-selected={selected || undefined}
      disabled={disabled}
      title={disabled ? reason : undefined}
      onClick={onSelect}
      onMouseEnter={onFocus}
      onFocus={onFocus}
    >
      <Asset id="notify.bracketFg" height={34} tint="currentColor" className={styles.bar} />
      <span className={styles.label}>{label}</span>
      {hint !== undefined && <span className={styles.hint}>{hint}</span>}
    </button>
  );
}
