import { Asset } from "../../ui/Asset";
import { CellFrame } from "../../ui/FrameBox";
import styles from "./story.module.css";
import type { View } from "./view";

/**
 * 消息页的新闻栏：N54 快讯、电台播报与听来的街头风声 / 本地街坊传闻；
 * 纯浏览市井信息，不塞押金、奖金或领赏清单
 */
export function NewsBody({ view }: { readonly view: View }) {
  const entries = view.bulletins;
  const streetRumors = view.feed.filter((item) => item.channel === "street");
  const localFlavor = view.sidegigs.list.filter((g) => g.here);
  const empty = entries.length === 0 && streetRumors.length === 0 && localFlavor.length === 0;

  return (
    <section className={styles.feedSection} aria-label="新闻与街头风声">
      {empty ? (
        <div className={styles.feedEmpty}>
          <CellFrame />
          <Asset id="notify.journal" tint="var(--cp-cyan-dim)" height={24} />
          <b className={styles.feedEmptyTitle}>暂无新闻与风声</b>
          <p className={styles.feedEmptyText}>
            N54 快讯、街头电台和近处街坊流传的新近动静会同步汇到这里。
          </p>
        </div>
      ) : (
        <>
          {(streetRumors.length > 0 || localFlavor.length > 0) && (
            <div className={styles.feedGroup}>
              <h3 className={styles.feedSubhead}>街坊风声</h3>
              <ul className={styles.feedList}>
                {streetRumors.map((r) => (
                  <li
                    key={r.id}
                    className={styles.feedCard}
                    data-channel="street"
                    data-unread={r.unread || undefined}
                  >
                    <CellFrame />
                    <header className={styles.feedHead}>
                      <span className={styles.feedSource}>
                        <Asset id="notify.attention" tint="var(--cp-yellow)" height={14} />
                        {r.from}
                      </span>
                      <time className={styles.feedTime}>{r.time}</time>
                    </header>
                    <p className={styles.feedText}>{r.text}</p>
                  </li>
                ))}
                {localFlavor.map((g) => (
                  <li key={`flavor:${g.id}`} className={styles.feedCard} data-channel="street">
                    <CellFrame />
                    <header className={styles.feedHead}>
                      <span className={styles.feedSource}>
                        <Asset id="notify.attention" tint="var(--cp-yellow)" height={14} />
                        附近街区 · {g.kindLabel}
                      </span>
                      {g.beaten && <span className={styles.feedTime}>街坊还在议论上回那场</span>}
                    </header>
                    <b className={styles.feedTitle}>{g.name}</b>
                    {g.note && <p className={styles.feedText}>{g.note}</p>}
                    {g.rematch && (
                      <p className={styles.feedNote}>风声说大概要等到 {g.rematch} 才重新凑齐人。</p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {entries.length > 0 && (
            <div className={styles.feedGroup}>
              {(streetRumors.length > 0 || localFlavor.length > 0) && (
                <h3 className={styles.feedSubhead}>N54 与电台</h3>
              )}
              <ul className={styles.feedList}>
                {entries.map((b) => (
                  <li key={b.id} className={styles.feedCard} data-channel="news" data-kind={b.kind}>
                    <CellFrame />
                    <header className={styles.feedHead}>
                      <span className={styles.feedSource}>
                        <Asset id="notify.journal" tint="var(--cp-cyan)" height={14} />
                        {b.label}
                      </span>
                      <time className={styles.feedTime}>{b.time}</time>
                    </header>
                    <b className={styles.feedTitle}>{b.title}</b>
                    {b.text && <p className={styles.feedText}>{b.text}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
