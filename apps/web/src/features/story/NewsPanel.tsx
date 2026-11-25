import { useMemo, useState } from "react";
import { Asset } from "../../ui/Asset";
import { CellFrame } from "../../ui/FrameBox";
import { UnreadBadge } from "./Phone";
import styles from "./phone.module.css";
import type { View } from "./view";

type NewsFilter = "all" | "street" | "broadcast";

const NEWS_SEARCH_THRESHOLD = 6;

/**
 * 消息页的新闻栏（N54 WIRE）：N54 快讯、电台播报与听来的街头风声 / 本地街坊传闻；
 * 独立滚动容器 + 频道筛选 + 条目较多时附带轻量搜索
 */
export function NewsBody({ view }: { readonly view: View }) {
  const entries = view.bulletins;
  const wireNews = view.feed.filter((item) => item.channel === "news" && item.source !== "city");
  const streetRumors = view.feed.filter((item) => item.channel === "street");
  const localFlavor = view.sidegigs.list.filter((g) => g.here);

  const streetCount = streetRumors.length + localFlavor.length;
  const broadcastCount = entries.length + wireNews.length;
  const totalCount = streetCount + broadcastCount;

  const [filter, setFilter] = useState<NewsFilter>("all");
  const [query, setQuery] = useState("");
  const activeFilter: NewsFilter =
    (filter === "street" && streetCount === 0) || (filter === "broadcast" && broadcastCount === 0)
      ? "all"
      : filter;

  const showSearch = totalCount >= NEWS_SEARCH_THRESHOLD;
  const keyword = showSearch ? query.trim().toLocaleLowerCase() : "";

  const visibleRumors = useMemo(() => {
    if (activeFilter === "broadcast") return [];
    if (!keyword) return streetRumors;
    return streetRumors.filter((r) => `${r.from}\n${r.text}`.toLocaleLowerCase().includes(keyword));
  }, [activeFilter, keyword, streetRumors]);

  const visibleLocal = useMemo(() => {
    if (activeFilter === "broadcast") return [];
    if (!keyword) return localFlavor;
    return localFlavor.filter((g) =>
      `${g.kindLabel}\n${g.name}\n${g.note ?? ""}`.toLocaleLowerCase().includes(keyword),
    );
  }, [activeFilter, keyword, localFlavor]);

  const visibleWireNews = useMemo(() => {
    if (activeFilter === "street") return [];
    if (!keyword) return wireNews;
    return wireNews.filter((n) => `${n.from}\n${n.text}`.toLocaleLowerCase().includes(keyword));
  }, [activeFilter, keyword, wireNews]);

  const visibleEntries = useMemo(() => {
    if (activeFilter === "street") return [];
    if (!keyword) return entries;
    return entries.filter((b) =>
      `${b.label}\n${b.title}\n${b.text ?? ""}`.toLocaleLowerCase().includes(keyword),
    );
  }, [activeFilter, entries, keyword]);

  const hasVisibleStreet = visibleRumors.length > 0 || visibleLocal.length > 0;
  const hasVisibleBroadcast = visibleEntries.length > 0 || visibleWireNews.length > 0;
  const noMatch = totalCount > 0 && !hasVisibleStreet && !hasVisibleBroadcast;

  return (
    <section className={styles.newsShell} aria-label="新闻与街头风声">
      {totalCount === 0 ? (
        <div className={styles.emptyWrap}>
          <div className={styles.emptyCard}>
            <CellFrame />
            <Asset id="notify.journal" tint="var(--cp-cyan-dim)" height={24} />
            <span className={styles.emptyKicker}>{"N54 WIRE // NO SIGNAL"}</span>
            <b className={styles.emptyTitle}>暂无新闻与风声</b>
            <p className={styles.emptyText}>
              N54 快讯、街头电台和近处街坊流传的新近动静会同步汇到这里。
            </p>
          </div>
        </div>
      ) : (
        <>
          <header className={styles.newsTopBar}>
            <span className={styles.newsBrand}>
              <span className={styles.newsTagN54}>N54</span>
              <span>NIGHT CITY WIRE</span>
            </span>

            <div className={styles.newsControls}>
              {streetCount > 0 && broadcastCount > 0 && (
                <fieldset className={styles.filterBar}>
                  <legend className={styles.srOnly}>筛选新闻频道</legend>
                  <button
                    type="button"
                    className={styles.filterBtn}
                    aria-pressed={activeFilter === "all"}
                    onClick={() => setFilter("all")}
                  >
                    <span>全部</span>
                    <span className={styles.filterCount}>{totalCount}</span>
                  </button>
                  <button
                    type="button"
                    className={styles.filterBtn}
                    aria-pressed={activeFilter === "street"}
                    onClick={() => setFilter("street")}
                  >
                    <span>街坊风声</span>
                    <span className={styles.filterCount}>{streetCount}</span>
                  </button>
                  <button
                    type="button"
                    className={styles.filterBtn}
                    aria-pressed={activeFilter === "broadcast"}
                    onClick={() => setFilter("broadcast")}
                  >
                    <span>N54 与电台</span>
                    <span className={styles.filterCount}>{broadcastCount}</span>
                  </button>
                </fieldset>
              )}

              {showSearch && (
                <div className={`${styles.searchBox} ${styles.newsSearchWrap}`}>
                  <CellFrame />
                  <span className={styles.searchIcon} aria-hidden="true">
                    /
                  </span>
                  <input
                    type="search"
                    className={styles.searchInput}
                    value={query}
                    placeholder="检索快讯或风声…"
                    aria-label="检索新闻与街头风声"
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  {query && (
                    <button
                      type="button"
                      className={styles.searchClear}
                      aria-label="清空检索"
                      onClick={() => setQuery("")}
                    >
                      ×
                    </button>
                  )}
                </div>
              )}
            </div>
          </header>

          <div className={styles.newsScroll}>
            {noMatch ? (
              <div className={styles.rosterEmpty}>
                <span>没有匹配「{query.trim()}」的新闻或街头风声</span>
                <button
                  type="button"
                  className={styles.rosterResetBtn}
                  onClick={() => {
                    setFilter("all");
                    setQuery("");
                  }}
                >
                  重置筛选
                </button>
              </div>
            ) : (
              <>
                {hasVisibleStreet && (
                  <div className={styles.newsGroup}>
                    <h3 className={styles.newsSubhead}>街坊风声</h3>
                    <ul className={styles.newsList}>
                      {visibleRumors.map((r) => (
                        <li
                          key={r.id}
                          className={styles.newsCard}
                          data-channel="street"
                          data-unread={r.unread || undefined}
                        >
                          <header className={styles.newsCardHead}>
                            <span className={styles.newsSource}>
                              <Asset id="notify.attention" tint="var(--cp-yellow)" height={14} />
                              <span>{r.from}</span>
                            </span>
                            {r.unread && <UnreadBadge>新</UnreadBadge>}
                            <time className={styles.newsTime}>{r.time}</time>
                          </header>
                          <p className={styles.newsText}>{r.text}</p>
                        </li>
                      ))}
                      {visibleLocal.map((g) => (
                        <li key={`flavor:${g.id}`} className={styles.newsCard} data-channel="local">
                          <header className={styles.newsCardHead}>
                            <span className={styles.newsSource}>
                              <Asset id="notify.attention" tint="var(--cp-yellow)" height={14} />
                              <span>附近街区 · {g.kindLabel}</span>
                            </span>
                            {g.beaten && (
                              <span className={styles.newsTime}>街坊还在议论上回那场</span>
                            )}
                          </header>
                          <b className={styles.newsTitle}>{g.name}</b>
                          {g.note && <p className={styles.newsText}>{g.note}</p>}
                          {g.rematch && (
                            <p className={styles.newsNote}>
                              风声说大概要等到 {g.rematch} 才重新凑齐人。
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {hasVisibleBroadcast && (
                  <div className={styles.newsGroup}>
                    <h3 className={styles.newsSubhead}>N54 与电台</h3>
                    <ul className={styles.newsList}>
                      {visibleWireNews.map((n) => (
                        <li
                          key={n.id}
                          className={styles.newsCard}
                          data-channel="news"
                          data-unread={n.unread || undefined}
                        >
                          <header className={styles.newsCardHead}>
                            <span className={styles.newsSource}>
                              <Asset id="notify.journal" tint="var(--cp-cyan)" height={14} />
                              <span>{n.from}</span>
                            </span>
                            {n.unread && <UnreadBadge>新</UnreadBadge>}
                            <time className={styles.newsTime}>{n.time}</time>
                          </header>
                          <p className={styles.newsText}>{n.text}</p>
                        </li>
                      ))}
                      {visibleEntries.map((b) => (
                        <li
                          key={b.id}
                          className={styles.newsCard}
                          data-channel="news"
                          data-kind={b.kind}
                        >
                          <header className={styles.newsCardHead}>
                            <span className={styles.newsSource}>
                              <Asset id="notify.journal" tint="var(--cp-cyan)" height={14} />
                              <span>{b.label}</span>
                            </span>
                            <time className={styles.newsTime}>{b.time}</time>
                          </header>
                          <b className={styles.newsTitle}>{b.title}</b>
                          {b.text && <p className={styles.newsText}>{b.text}</p>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}
