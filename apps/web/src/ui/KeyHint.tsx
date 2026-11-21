import type { ReactNode } from "react";
import type { AssetId } from "../assets";
import { Asset } from "./Asset";
import styles from "./keyhint.module.css";

interface KeyHintProps {
  readonly keyId?: AssetId | undefined;
  /** 图集里没有的键位（如 Z、H）用等宽赛博键帽 */
  readonly keyText?: string | undefined;
  readonly label: string;
  readonly active?: boolean | undefined;
  readonly badge?: number | undefined;
  readonly title?: string | undefined;
  readonly onClick?: (() => void) | undefined;
  readonly disabled?: boolean | undefined;
}

/** 底部键位提示：[F] 确认；能点的做成按钮，支持激活态与角标计数 */
export function KeyHint({
  keyId,
  keyText,
  label,
  active,
  badge,
  title,
  onClick,
  disabled,
}: KeyHintProps) {
  const body = (
    <>
      {keyId ? (
        <Asset id={keyId} height={20} tint="currentColor" />
      ) : (
        keyText && <kbd className={styles.cap}>{keyText}</kbd>
      )}
      <span>{label}</span>
      {badge !== undefined && badge > 0 && (
        <em className={styles.badge}>{badge > 99 ? "99+" : badge}</em>
      )}
    </>
  );
  if (!onClick) {
    return (
      <span className={styles.hint} data-active={active || undefined} title={title}>
        {body}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={styles.hint}
      data-active={active || undefined}
      aria-pressed={active}
      title={title}
      onClick={onClick}
      disabled={disabled}
    >
      {body}
    </button>
  );
}

export function KeyBar({ children }: { readonly children: ReactNode }) {
  return <footer className={styles.bar}>{children}</footer>;
}
