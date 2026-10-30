import { ActionButton } from "../../ui/ActionButton";
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
    <div className={styles.docBody}>
      <section>
        {entries.length === 0 ? (
          <p className={styles.dim}>频段里很安静，没有截听到警情。</p>
        ) : (
          <ul className={styles.factionList}>
            {entries.map((i) => {
              const place = i.attachments.find((a) => a.kind === "location");
              const alert = alerts.get(i.id);
              return (
                <li key={i.id} className={styles.factionLine} data-unread={i.unread || undefined}>
                  <span className={styles.dim}>
                    {i.time} · {i.from}
                  </span>
                  <p>{i.text}</p>
                  {alert && (
                    <p className={styles.dim}>
                      赏金 {alert.reward.toLocaleString("en-US")} 欧元 · {alert.until} 前
                    </p>
                  )}
                  {place && onMap && (
                    <ActionButton onClick={onMap}>在地图上看 {place.label}</ActionButton>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

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
