import { ActionButton } from "../../ui/ActionButton";
import { Asset } from "../../ui/Asset";
import { CellFrame } from "../../ui/FrameBox";
import { UnreadBadge } from "./Phone";
import styles from "./story.module.css";
import type { View } from "./view";

/**
 * 警用频段（第六节第 1 条）：截听到的 NCPD 扫描器警情和自己的通缉升级，新的在上；
 * 带地点的警情可以打开地图，警情的标记已经画在地图上
 */
export function PoliceBody({
  view,
  onMap,
}: {
  readonly view: View;
  /** 打开地图浮层；不传时不出按钮 */
  readonly onMap?: (() => void) | undefined;
}) {
  const entries = view.feed.filter((i) => i.channel === "police");
  // 警情的赏金和期限在 ncpd 视图里，feed 的 id 是 ncpd:警情 id
  const alerts = new Map(view.ncpd.alerts.map((a) => [`ncpd:${a.id}`, a]));

  return (
    <section className={styles.feedSection} aria-label="警用频段">
      {entries.length === 0 ? (
        <div className={styles.feedEmpty}>
          <CellFrame />
          <Asset id="map.poi.police" tint="var(--cp-red-dim)" height={24} />
          <b className={styles.feedEmptyTitle}>警用频段静默</b>
          <p className={styles.feedEmptyText}>当前未截听到 NCPD 调度通报或赏金警情。</p>
        </div>
      ) : (
        <ul className={styles.feedList}>
          {entries.map((i) => {
            const place = i.attachments.find((a) => a.kind === "location");
            const alert = alerts.get(i.id);
            return (
              <li
                key={i.id}
                className={styles.feedCard}
                data-channel="police"
                data-unread={i.unread || undefined}
              >
                <CellFrame />
                <header className={styles.feedHead}>
                  <span className={styles.feedSource}>
                    <Asset id="map.poi.police" tint="var(--cp-red)" height={14} />
                    {i.from}
                  </span>
                  {i.unread && <UnreadBadge>新</UnreadBadge>}
                  <time className={styles.feedTime}>{i.time}</time>
                </header>
                <p className={styles.feedText}>{i.text}</p>
                {(alert || (place && onMap)) && (
                  <footer className={styles.feedFoot}>
                    {alert && (
                      <span className={styles.feedBounty}>
                        赏金 {alert.reward.toLocaleString("en-US")} 欧元 · {alert.until} 前
                      </span>
                    )}
                    {place && onMap && (
                      <ActionButton onClick={onMap}>在地图看 {place.label}</ActionButton>
                    )}
                  </footer>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * 消息页的新闻栏：场外推演写下的 N54 快讯和电台播报，新的在上；
 * 只是翻看，不打断剧情，也不花时间
 */
export function NewsBody({ view }: { readonly view: View }) {
  const entries = view.bulletins;

  return (
    <section className={styles.feedSection} aria-label="新闻快讯">
      {entries.length === 0 ? (
        <div className={styles.feedEmpty}>
          <CellFrame />
          <Asset id="notify.journal" tint="var(--cp-cyan-dim)" height={24} />
          <b className={styles.feedEmptyTitle}>暂无新闻播报</b>
          <p className={styles.feedEmptyText}>N54 与街头电台的新近简讯会同步推送到这里。</p>
        </div>
      ) : (
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
      )}
    </section>
  );
}
