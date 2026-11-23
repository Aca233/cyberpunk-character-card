import { useMemo, useState } from "react";
import { ActionButton } from "../../ui/ActionButton";
import { Asset } from "../../ui/Asset";
import { CellFrame } from "../../ui/FrameBox";
import { Avatar } from "./Phone";
import { Profile } from "./Profile";
import styles from "./phone.module.css";
import { type PeopleFilter, type PersonDirectoryItem, peopleDirectory, type View } from "./view";

const SEARCH_THRESHOLD = 4;

const PEOPLE_FILTER_OPTIONS: readonly {
  readonly id: PeopleFilter;
  readonly label: string;
  readonly match: (p: PersonDirectoryItem) => boolean;
}[] = [
  { id: "all", label: "全部", match: () => true },
  { id: "present", label: "在场", match: (p) => p.isPresent },
  { id: "met", label: "已见面", match: (p) => p.met },
  { id: "heard", label: "仅听说", match: (p) => !p.met },
  { id: "linked", label: "已留频道", match: (p) => p.hasContact },
  { id: "unlinked", label: "未留频道", match: (p) => !p.hasContact },
];

function computePeopleFilters(people: readonly PersonDirectoryItem[]) {
  const counts: Record<PeopleFilter, number> = {
    all: people.length,
    present: 0,
    met: 0,
    heard: 0,
    linked: 0,
    unlinked: 0,
  };
  for (const p of people) {
    if (p.isPresent) counts.present += 1;
    if (p.met) counts.met += 1;
    else counts.heard += 1;
    if (p.hasContact) counts.linked += 1;
    else counts.unlinked += 1;
  }
  return {
    counts,
    tabs: PEOPLE_FILTER_OPTIONS.filter((opt) => opt.id === "all" || counts[opt.id] > 0).map(
      (opt) => ({
        ...opt,
        count: counts[opt.id],
      }),
    ),
  };
}

function matchesPeopleSearch(p: PersonDirectoryItem, q: string): boolean {
  const hay = [
    p.name,
    p.npc.alias ?? "",
    p.npc.role ?? "",
    p.npc.faction ?? "",
    p.npc.lastPlace ?? "",
    p.npc.homePlace ?? "",
    p.utilityLine,
    p.highlight ?? "",
    p.hasContact ? "已连线 已留频道 通讯录" : "未留联系方式 未留频道",
    ...p.badges.map((b) => b.label),
  ]
    .join("\n")
    .toLocaleLowerCase();
  return hay.includes(q);
}

/** 独立「人物」页：集中展示所有已知人物（见过 / 仅听说 / 在场 / 同行），并与手机通讯录状态清晰分离 */
export function PeopleBody({
  view,
  onOpenChat,
  onLocatePlace,
  onScan,
  onCompanion,
  onDraftAction,
}: {
  readonly view: View;
  /** 点击已连线人物的「发消息」按钮：跳到手机「消息」页并选中该会话 */
  readonly onOpenChat?: ((contactId: string) => void) | undefined;
  /** 地图定位到人物所在地点 */
  readonly onLocatePlace?: ((placeId: string) => void) | undefined;
  readonly onScan?: ((id: string) => void) | undefined;
  readonly onCompanion?: ((id: string, following: boolean) => void) | undefined;
  readonly onDraftAction?: ((text: string) => void) | undefined;
}) {
  const people = useMemo(() => peopleDirectory(view), [view]);
  const { counts, tabs } = useMemo(() => computePeopleFilters(people), [people]);
  const [filter, setFilter] = useState<PeopleFilter>("all");
  const [query, setQuery] = useState("");
  const activeFilter: PeopleFilter = filter !== "all" && counts[filter] > 0 ? filter : "all";
  const filterRule =
    PEOPLE_FILTER_OPTIONS.find((opt) => opt.id === activeFilter) ?? PEOPLE_FILTER_OPTIONS[0];

  const showSearch = people.length > SEARCH_THRESHOLD;
  const keyword = showSearch ? query.trim().toLocaleLowerCase() : "";

  const filtered = useMemo(() => {
    const byTab =
      activeFilter === "all" || !filterRule ? people : people.filter((p) => filterRule.match(p));
    return keyword ? byTab.filter((p) => matchesPeopleSearch(p, keyword)) : byTab;
  }, [activeFilter, filterRule, keyword, people]);

  const [picked, setPicked] = useState<string | null>(() => people[0]?.key ?? null);
  const current = filtered.find((p) => p.key === picked) ?? filtered[0] ?? people[0];

  if (people.length === 0 || !current) {
    return (
      <div className={styles.noContacts}>
        <div className={styles.emptyWrap}>
          <div className={styles.emptyCard}>
            <CellFrame />
            <Asset id="notify.attention" tint="var(--cp-cyan-dim)" height={24} />
            <span className={styles.emptyKicker}>{"DOSSIER // STANDBY"}</span>
            <b className={styles.emptyTitle}>暂无已知人物</b>
            <p className={styles.emptyText}>
              在夜之城遇见或听闻的人物会归档在这里；互留联系方式后，才会同步到「消息」通讯录。
            </p>
          </div>
        </div>
      </div>
    );
  }

  const topSlot = (
    <div style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", flexWrap: "wrap" }}>
      <span
        className={styles.badge}
        data-tone={current.hasContact ? "cyan" : "dim"}
        title={
          current.hasContact
            ? "双方已建立全息联系方式，可在「消息」页直接私聊"
            : "尚未交换联系方式，需在剧情中互留频道后才可远程私信"
        }
      >
        {current.hasContact ? "已连线" : "未留联系方式"}
      </span>
      {current.hasContact && onOpenChat && (
        <ActionButton
          title={`打开与 ${current.name} 的全息私信`}
          onClick={() => onOpenChat(current.key)}
        >
          <span className={styles.headActionContent}>
            <Asset id="interaction.talk" tint="currentColor" height={12} />
            <span>发消息</span>
          </span>
        </ActionButton>
      )}
      {current.locatePlaceId && current.locatePlaceName && onLocatePlace && (
        <ActionButton
          title={`在地图上定位到${current.locatePlaceName}`}
          onClick={() => onLocatePlace(current.locatePlaceId as string)}
        >
          <span className={styles.headActionContent}>
            <Asset id="map.pinDest" tint="currentColor" height={12} />
            <span>定位</span>
          </span>
        </ActionButton>
      )}
    </div>
  );

  return (
    <div className={styles.layout}>
      <aside className={styles.roster} aria-label="已知人物筛选与目录">
        <div className={styles.rosterBar}>
          <span className={styles.rosterKicker}>{"DOSSIER // PEOPLE"}</span>
          <span className={styles.rosterStats}>
            {counts.linked > 0 ? (
              <>
                <b>{counts.linked}</b> 连线 · {people.length} 人
              </>
            ) : (
              `${people.length} 人物`
            )}
          </span>
        </div>

        {showSearch && (
          <div className={styles.searchBox}>
            <CellFrame />
            <span className={styles.searchIcon} aria-hidden="true">
              /
            </span>
            <input
              type="search"
              className={styles.searchInput}
              value={query}
              placeholder="搜姓名、职能、势力、地点…"
              aria-label="搜索已知人物"
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button
                type="button"
                className={styles.searchClear}
                aria-label="清空搜索"
                onClick={() => setQuery("")}
              >
                ×
              </button>
            )}
          </div>
        )}

        {tabs.length > 1 && people.length > 2 && (
          <fieldset className={styles.filterBar}>
            <legend className={styles.srOnly}>筛选已知人物</legend>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={styles.filterBtn}
                data-tone={tab.id === "present" ? "unread" : undefined}
                aria-pressed={activeFilter === tab.id}
                onClick={() => setFilter(tab.id)}
              >
                <span>{tab.label}</span>
                <span className={styles.filterCount}>{tab.count}</span>
              </button>
            ))}
          </fieldset>
        )}

        {filtered.length > 0 ? (
          <ul className={styles.contactList} aria-label="已知人物">
            {filtered.map((p) => {
              const active = p.key === current.key;
              const dead = !p.alive;
              const statusBadge = p.hasContact
                ? { label: "已连线", tone: "cyan" as const }
                : { label: "未留频道", tone: "dim" as const };
              const subLine = p.highlight || p.utilityLine;
              return (
                <li key={p.key}>
                  <button
                    type="button"
                    className={styles.contactBtn}
                    aria-pressed={active}
                    data-dead={dead || undefined}
                    onClick={() => setPicked(p.key)}
                  >
                    <Avatar
                      npc={p.npc.id}
                      name={p.name}
                      dead={dead}
                      present={p.isPresent}
                      scan={active}
                    />
                    <span className={styles.contactInfo}>
                      <span className={styles.contactTop}>
                        <b className={styles.contactName}>{p.name}</b>
                        <span className={styles.badge} data-tone={statusBadge.tone}>
                          {statusBadge.label}
                        </span>
                      </span>
                      <span className={styles.contactBottom}>
                        <small className={styles.contactSub}>{subLine}</small>
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className={styles.rosterEmpty}>
            <span>没有匹配的已知人物</span>
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
        )}
      </aside>

      <section
        className={styles.threadPane}
        aria-label={`${current.name}的人物档案`}
        style={{ paddingLeft: "0.7rem", overflowY: "auto" }}
      >
        <Profile
          key={current.npc.id}
          npc={current.npc}
          fixer={current.fixer}
          foe={current.foe}
          embedded
          topSlot={topSlot}
          onScan={onScan}
          onCompanion={onCompanion}
          onDraftAction={onDraftAction}
        />
      </section>
    </div>
  );
}
