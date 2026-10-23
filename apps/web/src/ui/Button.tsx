import type { ReactNode } from "react";
import type { AssetId } from "../assets";
import { Asset, NineSlice } from "./Asset";
import styles from "./button.module.css";

interface ButtonProps {
  readonly children: ReactNode;
  readonly onClick?: (() => void) | undefined;
  readonly disabled?: boolean | undefined;
  /** 不能点时的原因，悬停显示 */
  readonly reason?: string | undefined;
  readonly keyId?: AssetId | undefined;
  readonly primary?: boolean;
  readonly type?: "button" | "submit";
}

/** 原作标签页底的按钮：斜切角，主按钮黄色，其余红色 */
export function Button({
  children,
  onClick,
  disabled,
  reason,
  keyId,
  primary,
  type = "button",
}: ButtonProps) {
  return (
    <button
      type={type}
      className={styles.button}
      data-primary={primary || undefined}
      onClick={onClick}
      disabled={disabled}
      title={disabled ? reason : undefined}
    >
      <NineSlice id="tab.bg" tint="currentColor" slice={14} className={styles.bg} />
      {keyId && <Asset id={keyId} height={20} tint="currentColor" />}
      <span className={styles.label}>{children}</span>
    </button>
  );
}
