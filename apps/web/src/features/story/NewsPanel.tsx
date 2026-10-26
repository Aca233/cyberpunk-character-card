import { useEffect } from "react";
import { Button } from "../../ui/Button";
import { Panel } from "../../ui/Panel";
import styles from "./story.module.css";
import type { View } from "./view";

/**
 * 新闻：场外推演写下的 N54 快讯和电台播报，新的在上；
 * 只是翻看，不打断剧情，也不花时间
 */
export function NewsPanel({
  view,
  onClose,
}: {
  readonly view: View;
  readonly onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const entries = view.bulletins;

  return (
    <div className={styles.journalBackdrop}>
      <div role="dialog" aria-label="新闻" className={styles.journal}>
        <Panel as="div" title="新闻" line="var(--cp-yellow)">
          <div className={styles.docHead}>
            <p className={`${styles.dim} ${styles.docNote}`}>
              N54 快讯和电台里播过的东西。镜头外的城市一直在动，这里只收得到上了广播的那部分。
            </p>
            <Button onClick={onClose}>关闭</Button>
          </div>
          <div className={styles.docBody}>
            <section>
              {entries.length === 0 ? (
                <p className={styles.dim}>还没有播报。</p>
              ) : (
                <ul className={styles.factionList}>
                  {entries.map((b) => (
                    <li key={b.id} className={styles.factionLine} data-kind={b.kind}>
                      <span className={styles.dim}>
                        {b.time} · {b.label}
                      </span>{" "}
                      <b>{b.title}</b>
                      {b.text && <p>{b.text}</p>}
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
