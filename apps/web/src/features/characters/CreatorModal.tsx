import { type ReactNode, useEffect, useId, useRef } from "react";
import { NineSlice } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { useLayer } from "../../ui/layers";
import wb from "./workbench.module.css";

/**
 * 工作台的居中大弹窗：出身、特质、缺陷、行装、人脉、地图选点都在这里选，
 * 不再塞进窄栏；Esc 或点背景关闭，内容区单独滚动，标题栏常驻。
 */
export function CreatorModal({
  title,
  hint,
  onClose,
  children,
}: {
  readonly title: string;
  readonly hint?: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const isTop = useLayer(onClose);
  const dialogRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const hintId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const trigger = document.activeElement;
    const focusable = () =>
      [
        ...dialog.querySelectorAll<HTMLElement>(
          "button, input, select, textarea, a[href], summary, [tabindex]",
        ),
      ].filter(
        (element) =>
          element.tabIndex >= 0 &&
          !element.matches(":disabled") &&
          element.getClientRects().length > 0,
      );
    const focusFirst = () => (focusable()[0] ?? dialog).focus({ preventScroll: true });
    focusFirst();
    const trapTab = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !isTop()) return;
      const elements = focusable();
      const first = elements[0];
      const last = elements.at(-1);
      if (!first || !last) {
        event.preventDefault();
        dialog.focus();
      } else if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === dialog)
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const keepFocus = (event: FocusEvent) => {
      if (isTop() && event.target instanceof Node && !dialog.contains(event.target)) focusFirst();
    };
    document.addEventListener("keydown", trapTab);
    document.addEventListener("focusin", keepFocus);
    return () => {
      document.removeEventListener("keydown", trapTab);
      document.removeEventListener("focusin", keepFocus);
      if (trigger instanceof HTMLElement && trigger.isConnected)
        trigger.focus({ preventScroll: true });
    };
  }, [isTop]);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 点背景关闭是便利功能，键盘用 Esc
    <div
      className={wb.modalBackdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={hint ? hintId : undefined}
        tabIndex={-1}
        className={wb.modal}
      >
        <NineSlice
          id="notify.itemCellBg"
          tint="rgb(8 8 14 / 98%)"
          slice={30}
          className={wb.modalLayer}
        />
        <NineSlice id="panel.frame" tint="var(--cp-red)" slice={120} className={wb.modalLayer} />
        <header className={wb.modalHead}>
          <div>
            <h2 id={titleId} className={wb.modalTitle}>
              {title}
            </h2>
            {hint && (
              <p id={hintId} className={wb.modalHint}>
                {hint}
              </p>
            )}
          </div>
          <Button small onClick={onClose}>
            完成 · Esc
          </Button>
        </header>
        <div className={wb.modalBody}>{children}</div>
      </section>
    </div>
  );
}
