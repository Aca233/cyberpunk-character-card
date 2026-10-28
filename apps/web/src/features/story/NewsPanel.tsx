import styles from "./story.module.css";
import type { View } from "./view";

/**
 * 消息页的新闻栏：场外推演写下的 N54 快讯和电台播报，新的在上；
 * 只是翻看，不打断剧情，也不花时间
 */
export function NewsBody({ view }: { readonly view: View }) {
  const entries = view.bulletins;

  return (
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
  );
}
