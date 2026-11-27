import { type ReactNode, useEffect } from "react";
import { createPortal } from "react-dom";
import { playSfx } from "../audio";
import { Asset } from "./Asset";
import styles from "./dialog.module.css";
import { useLayer } from "./layers";
import { Panel } from "./Panel";

interface DialogProps {
  readonly title: string;
  readonly tone?: "warning" | "danger" | "info";
  /** 宽表单弹窗模式：拓宽容器并省去左侧警示图标，避免复杂表单被截断 */
  readonly wide?: boolean;
  readonly children: ReactNode;
  /** 底部按钮 */
  readonly actions: ReactNode;
  readonly onClose?: () => void;
}

/** 原作样式的提示框：居中、左侧警示图标、底部按钮；占面板栈顶，Esc 关闭（没有 onClose 时 Esc 不穿透到下层） */
export function Dialog({
  title,
  tone = "warning",
  wide = false,
  children,
  actions,
  onClose,
}: DialogProps) {
  useLayer(() => onClose?.());
  useEffect(() => {
    playSfx(tone === "danger" ? "warning" : "panelOpen");
  }, [tone]);
  const color =
    tone === "danger"
      ? "var(--cp-danger)"
      : tone === "info"
        ? "var(--cp-cyan)"
        : "var(--cp-yellow)";
  return createPortal(
    <div className={styles.backdrop}>
      <div
        role="alertdialog"
        aria-label={title}
        className={styles.dialog}
        data-wide={wide ? "" : undefined}
      >
        <Panel line={color} className={styles.panel}>
          <div className={styles.layout}>
            {!wide && (
              <Asset id="fluff.attentionFill" height={56} tint={color} className={styles.icon} />
            )}
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
    </div>,
    document.body,
  );
}
