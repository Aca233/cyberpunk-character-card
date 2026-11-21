import type { ReactNode } from "react";
import type { AssetId } from "../assets";
import { playSfx } from "../audio";
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
  /** 开关按钮：传了就带 aria-pressed，开着时青色 */
  readonly pressed?: boolean | undefined;
  /** 按钮上只有符号时的无障碍名字 */
  readonly label?: string | undefined;
  /** 工具栏里的小号按钮 */
  readonly small?: boolean;
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
  pressed,
  label,
  small,
}: ButtonProps) {
  return (
    <button
      type={type}
      className={styles.button}
      data-primary={primary || undefined}
      data-small={small || undefined}
      aria-pressed={pressed}
      aria-label={label}
      onMouseEnter={() => {
        if (!disabled) playSfx("hover");
      }}
      onClick={() => {
        if (!disabled) playSfx(primary ? "confirm" : "click");
        onClick?.();
      }}
      disabled={disabled}
      title={disabled ? reason : undefined}
    >
      <NineSlice id="tab.bg" tint="currentColor" slice={14} className={styles.bg} />
      {keyId && <Asset id={keyId} height={20} tint="currentColor" />}
      <span className={styles.label}>{children}</span>
    </button>
  );
}
