import { useEffect } from "react";
import { Asset } from "../../ui/Asset";
import styles from "./story.module.css";
import type { Toast } from "./view";

const SHOW_MS = 4500;

function ToastItem({
  toast,
  onDone,
}: {
  readonly toast: Toast;
  readonly onDone: (key: string) => void;
}) {
  useEffect(() => {
    const timer = window.setTimeout(() => onDone(toast.key), SHOW_MS);
    return () => window.clearTimeout(timer);
  }, [toast.key, onDone]);
  const tint =
    toast.tone === "good"
      ? "var(--cp-success)"
      : toast.tone === "bad"
        ? "var(--cp-danger)"
        : "var(--cp-yellow)";
  return (
    <li className={styles.toast} data-tone={toast.tone}>
      <Asset id={toast.icon} tint={tint} height={22} />
      <span>{toast.text}</span>
    </li>
  );
}

/** D 系统通知最多同时几条（计划第九节），更早的还在队列里等着到点消失，Z 通知记录里都能翻到 */
const SHOW_MAX = 3;

/** D 系统通知：接在 C 追踪下面，几秒后自己消失 */
export function Toasts({
  toasts,
  onDone,
}: {
  readonly toasts: readonly Toast[];
  readonly onDone: (key: string) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <ul className={styles.toasts} aria-live="polite">
      {toasts.slice(-SHOW_MAX).map((t) => (
        <ToastItem key={t.key} toast={t} onDone={onDone} />
      ))}
    </ul>
  );
}
