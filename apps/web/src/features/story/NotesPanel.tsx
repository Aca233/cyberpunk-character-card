import { Asset } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { useLayer } from "../../ui/layers";
import { Panel } from "../../ui/Panel";
import styles from "./story.module.css";
import type { Toast } from "./view";

/** 这次进剧情以来弹过的系统通知；只在网页里记，不写存档 */
export interface NoteEntry extends Toast {
  /** 弹出时游戏里的时间 */
  readonly at: string;
}

const TONE_COLOR: Readonly<Record<Toast["tone"], string>> = {
  good: "var(--cp-yellow)",
  bad: "var(--cp-red)",
  info: "var(--cp-cyan)",
};

/** 通知记录（Z，原作动作名「打开通知」）：新的在上；只是翻看，不调用模型、不花时间 */
export function NotesPanel({
  notes,
  onClose,
}: {
  readonly notes: readonly NoteEntry[];
  readonly onClose: () => void;
}) {
  useLayer(onClose);
  const list = [...notes].reverse();

  return (
    <div className={styles.journalBackdrop}>
      <div role="dialog" aria-label="通知" className={styles.journal}>
        <Panel as="div" title="通知" line="var(--cp-yellow)">
          <div className={styles.docHead}>
            <Button onClick={onClose}>关闭</Button>
          </div>
          <div className={styles.docBody}>
            <section>
              {list.length === 0 ? (
                <p className={styles.dim}>还没有通知。</p>
              ) : (
                <ul className={styles.factionList}>
                  {list.map((n) => (
                    <li key={n.key} className={styles.noteRow} data-tone={n.tone}>
                      <Asset id={n.icon} tint={TONE_COLOR[n.tone]} height={20} />
                      <span>{n.text}</span>
                      <small className={styles.dim}>{n.at}</small>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </Panel>
      </div>
    </div>
  );
}
