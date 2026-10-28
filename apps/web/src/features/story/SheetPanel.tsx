import type { ReactNode } from "react";
import { Button } from "../../ui/Button";
import { useLayer } from "../../ui/layers";
import styles from "./story.module.css";

/**
 * U1 临时容器：四角布局里没有旧左侧栏的位置，先把它原样收进一个走面板栈的面板，
 * 在生物监测块上点一下打开。侧栏里的按钮打开的面板叠在这一层上面，Esc 先关上面那层。
 * U2 把侧栏拆进神经界面各页以后，这个文件删掉
 */
export function SheetPanel({
  title,
  children,
  onClose,
}: {
  readonly title: string;
  readonly children: ReactNode;
  readonly onClose: () => void;
}) {
  useLayer(onClose);
  return (
    <div className={styles.journalBackdrop}>
      <div role="dialog" aria-label={title} className={styles.sheet}>
        <div className={styles.docHead}>
          <Button onClick={onClose}>关闭</Button>
        </div>
        <div className={styles.sheetBody}>{children}</div>
      </div>
    </div>
  );
}
