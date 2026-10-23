import { type ReactNode, useEffect } from "react";
import { Asset } from "./Asset";
import styles from "./dialog.module.css";
import { Panel } from "./Panel";

interface DialogProps {
  readonly title: string;
  readonly tone?: "warning" | "danger" | "info";
  readonly children: ReactNode;
  /** 底部按钮 */
  readonly actions: ReactNode;
  readonly onClose?: () => void;
}

/** 原作样式的提示框：居中、左侧警示图标、底部按钮；Esc 关闭 */
export function Dialog({ title, tone = "warning", children, actions, onClose }: DialogProps) {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const color =
    tone === "danger"
      ? "var(--cp-danger)"
      : tone === "info"
        ? "var(--cp-cyan)"
        : "var(--cp-yellow)";
  return (
    <div className={styles.backdrop}>
      <div role="alertdialog" aria-label={title} className={styles.dialog}>
        <Panel line={color}>
          <div className={styles.layout}>
            <Asset id="fluff.attentionFill" height={56} tint={color} />
            <div className={styles.content}>
              <h2 className={styles.title} style={{ color }}>
                {title}
              </h2>
              <div className={styles.text}>{children}</div>
              <div className={styles.actions}>{actions}</div>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
