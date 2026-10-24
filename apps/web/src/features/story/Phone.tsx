import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import styles from "./story.module.css";
import type { View } from "./view";

/** 手机（简版）：按游戏时间列消息，最近的在前；联系人和完整手机界面在 M3 */
export function PhoneDialog({
  view,
  onReply,
  onClose,
}: {
  readonly view: View;
  /** 回复一条：输入框进入回复状态；正在生成时不传，按钮不显示 */
  readonly onReply?: ((id: number) => void) | undefined;
  readonly onClose: () => void;
}) {
  const { messages } = view.phone;
  return (
    <Dialog
      title="手机"
      onClose={onClose}
      actions={
        <Button primary onClick={onClose}>
          关上
        </Button>
      }
    >
      {messages.length === 0 ? (
        <p className={styles.dim}>没有消息。</p>
      ) : (
        <ul className={styles.phoneList}>
          {messages.map((m) => (
            <li key={m.id} className={styles.phoneItem} data-unread={!m.read || undefined}>
              <p className={styles.phoneHead}>
                <b>{m.name}</b>
                <small>
                  {m.at}
                  {m.replied ? " · 已回复" : ""}
                </small>
              </p>
              <p className={styles.phoneText}>{m.text}</p>
              {onReply && (
                <button type="button" className={styles.habitButton} onClick={() => onReply(m.id)}>
                  回复
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
