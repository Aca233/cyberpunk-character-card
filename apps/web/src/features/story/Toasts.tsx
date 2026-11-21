import { Asset, NineSlice } from "../../ui/Asset";
import styles from "./story.module.css";
import type { Toast } from "./view";

const TONE_TINT: Readonly<Record<Toast["tone"], string>> = {
  good: "var(--cp-success)",
  bad: "var(--cp-danger)",
  info: "var(--cp-cyan)",
};

function ToastItem({
  toast,
  onDone,
}: {
  readonly toast: Toast;
  readonly onDone: (key: string) => void;
}) {
  return (
    <li className={styles.toast} data-tone={toast.tone}>
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
      <button
        type="button"
        className={styles.toastBtn}
        title="点击关闭通知"
        onClick={() => onDone(toast.key)}
      >
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
