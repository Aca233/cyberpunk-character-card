import { useEffect, useRef, useState } from "react";
import { Asset, NineSlice } from "../../ui/Asset";
import styles from "./story.module.css";
import type { Toast } from "./view";

const TONE_TINT: Readonly<Record<Toast["tone"], string>> = {
  good: "var(--cp-success)",
  bad: "var(--cp-danger)",
  info: "var(--cp-cyan)",
};

const LEAVE_MS = 180;

function ToastItem({
  toast,
  onDone,
}: {
  readonly toast: Toast;
  readonly onDone: (key: string) => void;
}) {
  const [leaving, setLeaving] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const dismiss = () => {
    if (leaving) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onDone(toast.key);
      return;
    }
    setLeaving(true);
    timerRef.current = window.setTimeout(() => onDone(toast.key), LEAVE_MS);
  };

  return (
    <li className={styles.toast} data-tone={toast.tone} data-leaving={leaving || undefined}>
      {/* 底和托架沿用原作素材，常态显示在右侧，点按即收起 */}
      <NineSlice
        id="notify.itemCellBg"
        tint="var(--cp-surface-raised)"
        slice={30}
        className={styles.toastBg}
      />
      <NineSlice
        id="notify.bracketBg"
        tint="var(--toast-tint)"
        slice={[12, 0, 12, 0]}
        className={styles.toastBracket}
      />
      <button type="button" className={styles.toastBtn} title="点击关闭通知" onClick={dismiss}>
        <Asset id={toast.icon} tint={TONE_TINT[toast.tone]} height={20} />
        <span className={styles.toastText}>{toast.text}</span>
      </button>
    </li>
  );
}

/** 常驻在右侧追踪下方展示，逐条点击即消失；队列最多保留 6 条，超出后仅显示最新几条 */
const SHOW_MAX = 6;

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
