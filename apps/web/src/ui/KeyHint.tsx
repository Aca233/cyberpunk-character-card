import type { ReactNode } from "react";
import type { AssetId } from "../assets";
import { Asset } from "./Asset";
import styles from "./keyhint.module.css";

interface KeyHintProps {
  readonly keyId: AssetId;
  readonly label: string;
  readonly onClick?: (() => void) | undefined;
  readonly disabled?: boolean | undefined;
}

/** 底部键位提示：[F] 确认；能点的做成按钮 */
export function KeyHint({ keyId, label, onClick, disabled }: KeyHintProps) {
  const body = (
    <>
      <Asset id={keyId} height={22} tint="currentColor" />
      <span>{label}</span>
    </>
  );
  if (!onClick) return <span className={styles.hint}>{body}</span>;
  return (
    <button type="button" className={styles.hint} onClick={onClick} disabled={disabled}>
      {body}
    </button>
  );
}

export function KeyBar({ children }: { readonly children: ReactNode }) {
  return <footer className={styles.bar}>{children}</footer>;
}
