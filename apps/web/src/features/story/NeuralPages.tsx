import { characterRules, type PlayerAction } from "@cp/core";
import { type ReactNode, useState } from "react";
import { Button } from "../../ui/Button";
import { Panel } from "../../ui/Panel";
import { BiomonitorPanel } from "./BiomonitorPanel";
import { ContentMediaList, InlineContentText } from "./ContentMedia";
import { CYBER_LABELS, CyberDoll, type CyberSlot } from "./CyberDoll";
import mediaStyles from "./content-media.module.css";
import { rarityLabelOf, rarityTintOf } from "./cyberwareMeta";
import { FactionsBody } from "./FactionsPanel";
import { type HabitAction, Habits } from "./Habits";
import { countdown } from "./Journal";
import { NewsBody } from "./NewsPanel";
import neural from "./neural.module.css";
import { Avatar, type PhoneActions, PhoneBody, UnreadBadge } from "./Phone";
import { Profile } from "./Profile";
import { type SquadAction, SquadPanel } from "./SquadPanel";
import styles from "./story.module.css";
import { trackTelemetry, type View } from "./view";

/**
 * 神经界面里由旧左侧栏拆出来的几页（2077-interface-plan.md 第五节第 4 条）：
 * 人物、义体、追踪、消息、联系人、资料与超梦档案；物品栏已迁至独立模块 InventoryPage。
 */

/** 人物（P）：3.0 生物检测读数、角色主板与习惯（无桌面端数值属性栏） */
export function CharacterPage({
  view,
  onHabit,
  onTrauma,
  onOpenNeuralChip,
  onActionDraft,
  busy,
}: {
  readonly view: View;
  readonly onHabit?: ((action: HabitAction, text: string) => void) | undefined;
  readonly onTrauma?:
    | ((action: Extract<PlayerAction, { type: "trauma" }>) => Promise<void>)
    | undefined;
  readonly onOpenNeuralChip?: ((carrierId?: string) => void) | undefined;
  readonly onActionDraft?: ((text: string) => void) | undefined;
  readonly busy?: boolean | undefined;
}) {
  const { character } = view;
  const firstWithAbility = character.traits.find((t) => Boolean(t.ability));
  const [activeTraitKey, setActiveTraitKey] = useState<string | null>(
    firstWithAbility ? `${firstWithAbility.slot}-${firstWithAbility.label}` : null,
  );
  const activeTrait =
    character.traits.find((t) => `${t.slot}-${t.label}` === activeTraitKey) ??
    firstWithAbility ??
    null;

  const origins = character.traits.filter((t) => t.slot === "origin");
  const modules = character.traits.filter((t) => t.slot !== "origin");

  const bindTrait = (t: View["character"]["traits"][number]) => {
    const key = `${t.slot}-${t.label}`;
    return {
      key,
      selected: activeTrait ? `${activeTrait.slot}-${activeTrait.label}` === key : false,
      title: t.ability || undefined,
      onClick: () => setActiveTraitKey(key),
      onMouseEnter: () => {
        if (t.ability) setActiveTraitKey(key);
      },
      onFocus: () => {
        if (t.ability) setActiveTraitKey(key);
      },
    };
  };

  return (
    <div className={styles.characterRoot}>
      {character.name === null && (
        <p className={styles.dim}>这是未绑定角色的旧存档。新建存档时可以选择自己的角色。</p>
      )}
      <BiomonitorPanel
        view={view}
        onTrauma={onTrauma}
        onOpenNeuralChip={onOpenNeuralChip}
        onActionDraft={onActionDraft}
        busy={busy}
      />

      {character.traits.length > 0 && (
        <section className={styles.traitSection} aria-label="角色主板">
          <div className={styles.traitBoard}>
            {origins.map((t) => {
              const { key, selected, ...interactive } = bindTrait(t);
              return (
                <button
                  key={key}
                  type="button"
                  className={styles.originPlaque}
                  aria-pressed={selected}
                  {...interactive}
                >
                  <small className={styles.originStamp}>
                    {characterRules.TRAIT_LABELS[t.slot]}
                  </small>
                  <span className={styles.originLabel}>{t.label}</span>
                </button>
              );
            })}
            {origins.length > 0 && modules.length > 0 && (
              <span className={styles.traitSep} aria-hidden />
            )}
            {modules.length > 0 && (
              <ul className={styles.traits}>
                {modules.map((t) => {
                  const { key, selected, ...interactive } = bindTrait(t);
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        className={styles.traitChip}
                        data-slot={t.slot}
                        aria-pressed={selected}
                        {...interactive}
                      >
                        <i className={styles.traitDot} aria-hidden />
                        <small className={styles.traitKind}>
                          {characterRules.TRAIT_LABELS[t.slot]}
                        </small>
                        <span className={styles.traitLabel}>{t.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {activeTrait?.ability && (
            <div className={styles.traitDetail} data-slot={activeTrait.slot} role="status">
              <div className={styles.traitDetailHead}>
                <small
                  className={activeTrait.slot === "origin" ? styles.originStamp : styles.traitKind}
                >
                  {characterRules.TRAIT_LABELS[activeTrait.slot]}
                </small>
                <b>{activeTrait.label}</b>
              </div>
              <p className={styles.traitDetailText}>{activeTrait.ability}</p>
            </div>
          )}
        </section>
      )}
      <Habits habits={character.habits} offers={character.habitOffers} onHabit={onHabit} />
    </div>
  );
}

type CyberPart = View["cyberware"][number];

/** 义体（原作 2077 义体页面布局：人体部位图 + 左侧人性条 + 悬停精简详情 + 右下角义体医生入口） */
export function CyberwarePage({
  view,
  onRipperdoc,
}: {
  readonly view: View;
  readonly onRipperdoc: () => void;
}) {
  // 一个部位按原作格数能装几件，按装上的先后排
  const bySlot = new Map<CyberSlot, CyberPart[]>();
  for (const c of view.cyberware) bySlot.set(c.slot, [...(bySlot.get(c.slot) ?? []), c]);
  const brokenCount = view.cyberware.filter((c) => c.broken).length;

  const tip = (slot: CyberSlot, _parts: readonly unknown[], index: number) => {
    const list = bySlot.get(slot) ?? [];
    const part = list[index];
    if (!part) {
      return (
        <p className={neural.cyberTipMuted}>
          {view.ripperdoc
            ? `空余槽位，可在${view.ripperdoc.name}的诊所安装或更换。`
            : "空余槽位，可前往义体医生诊所安装。"}
        </p>
      );
    }
    const rarityLabel = rarityLabelOf(part.rarity, part.iconic);
    return (
      <>
        <h3 className={neural.cyberName} data-broken={part.broken || undefined}>
          {part.name}
        </h3>
        <p className={neural.cyberTipMeta} data-broken={part.broken || undefined}>
          {[rarityLabel, CYBER_LABELS[slot], part.broken ? "已损毁（待修）" : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {part.ability && <p className={styles.cyberAbility}>{part.ability}</p>}
        {!part.broken && (part.deckProfile || (part.deckTraits && part.deckTraits.length > 0)) && (
          <p className={styles.dim}>
            {[part.deckTraits?.join(" · "), part.deckProfile].filter(Boolean).join(" — ")}
          </p>
        )}
        {part.behaviorChip && (
          <p className={styles.dim}>
            {[
              `芯片状态：${part.behaviorChip.label}`,
              part.behaviorChip.protocol ? `运行协议：${part.behaviorChip.protocol}` : null,
              part.behaviorChip.memoryGap ? "存在托管记忆断层" : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}
      </>
    );
  };

  return (
    <div className={neural.cyberPage}>
      <CyberDoll
        parts={bySlot}
        humanity={view.humanity}
        tip={tip}
        tipLine={(_slot, list, index) => {
          const part = list[index];
          if (!part) return "var(--cp-cyan)";
          return part.broken ? "var(--cp-danger)" : rarityTintOf(part.rarity, part.iconic);
        }}
        corner={
          (view.health.lostLimbs.length > 0 || view.ripperdoc) && (
            <>
              {view.health.lostLimbs.length > 0 && (
                <Panel as="section" title="断肢" line="var(--cp-red)">
                  <p className={styles.lostLimbs}>
                    {view.health.lostLimbs.map((l) => l.label).join("、")}
                  </p>
                </Panel>
              )}
              {view.ripperdoc && (
                <div>
                  {brokenCount > 0 && (
                    <p className={neural.cyberClinicHint}>{brokenCount} 件义体损毁待修</p>
                  )}
                  <Button primary onClick={onRipperdoc}>
                    义体医生 · {view.ripperdoc.name}
                  </Button>
                </div>
              )}
            </>
          )
        }
      />
    </div>
  );
}

/** 页内分栏：原作按钮素材，按下的那一栏 pressed */
function SubTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  readonly tabs: readonly (readonly [T, ReactNode])[];
  readonly value: T;
  readonly onChange: (tab: T) => void;
}) {
  return (
    <nav className={neural.sub}>
      {tabs.map(([id, label]) => (
        <Button key={id} small pressed={id === value} onClick={() => onChange(id)}>
          {label}
        </Button>
      ))}
    </nav>
  );
}

/** 追踪（J）：只列眼下揽在手里的单子与期限约定；日常超梦不自动生成待办。 */
export function JournalPage({ view }: { readonly view: View }) {
  const track = trackTelemetry(view);
  const placeNames = new Map((view.travel?.destinations ?? []).map((d) => [d.id, d.name]));
  const activeJobs = [...view.jobs.list.filter((j) => j.status === "active")].sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    if (a.dueIn !== null && b.dueIn !== null) return a.dueIn - b.dueIn;
    if (a.dueIn !== null) return -1;
    if (b.dueIn !== null) return 1;
    return 0;
  });
  const otherActive = track.active.filter((item) => item.source !== "jobs");
  const nothingActive = activeJobs.length === 0 && otherActive.length === 0;

  return (
    <div className={styles.trackPane}>
      {nothingActive && (
        <p className={styles.trackQuietNote}>
          手头眼下没有在办单子或约定；街头走动、回消息时谈妥的事会记到这里。
        </p>
      )}

      {activeJobs.length > 0 && (
        <section className={styles.trackSection}>
          <h3 className={styles.trackMicroHead}>手头在办</h3>
          <div className={styles.trackCleanList}>
            {activeJobs.map((job) => {
              const place =
                job.location === null ? null : (placeNames.get(job.location) ?? job.location);
              const metaTag = job.overdue
                ? "已超期"
                : job.dueIn !== null
                  ? countdown(job.dueIn)
                  : (job.kindLabel ?? (job.fixer ? `${job.fixer} 递话` : job.client));
              const detailsLine = [
                job.kindLabel,
                place,
                `委托方 ${job.client}`,
                job.fixer ? `牵线 ${job.fixer}` : null,
                job.reward > 0 ? `谈妥 ${job.reward.toLocaleString("en-US")} 欧元` : null,
              ]
                .filter(Boolean)
                .join(" · ");

              return (
                <details
                  key={job.id}
                  className={styles.trackGigItem}
                  data-overdue={job.overdue || undefined}
                >
                  <summary>
                    <strong>{job.title}</strong>
                    <span className={styles.trackGigMeta}>{metaTag}</span>
                  </summary>
                  <div className={styles.trackGigDetail}>
                    {detailsLine && <p>{detailsLine}</p>}
                    {job.due !== null && (
                      <p>
                        期限：{job.due}
                        {job.dueIn !== null ? ` · ${countdown(job.dueIn)}` : ""}
                      </p>
                    )}
                    {job.notes.length > 0 && (
                      <ol className={styles.trackNotes}>
                        {job.notes.map((note, i) => (
                          // biome-ignore lint/suspicious/noArrayIndexKey: 进展笔记按序追加
                          <li key={i}>{note}</li>
                        ))}
                      </ol>
                    )}
                  </div>
                </details>
              );
            })}
          </div>
        </section>
      )}

      {otherActive.length > 0 && (
        <section className={styles.trackSection}>
          <h3 className={styles.trackMicroHead}>
            {activeJobs.length > 0 ? "约定与进行中" : "正在进行"}
          </h3>
          <ul className={styles.trackCleanList}>
            {otherActive.map((item) => (
              <li
                key={item.id}
                className={styles.trackCleanRow}
                data-kind={item.kind}
                data-overdue={item.status === "overdue" || undefined}
              >
                <div className={styles.trackCleanTop}>
                  <strong>{item.title}</strong>
                  {item.dueLabel && (
                    <time
                      className={styles.trackCleanTime}
                      data-overdue={item.status === "overdue" || undefined}
                    >
                      {item.dueIn !== null && item.status !== "overdue"
                        ? `${item.dueLabel} · ${countdown(item.dueIn)}`
                        : item.dueLabel}
                    </time>
                  )}
                </div>
                <div className={styles.trackCleanMeta}>
                  <span>{item.sourceLabel}</span>
                  {item.location && !item.progress?.includes(item.location) && (
                    <span>{item.location}</span>
                  )}
                  {item.progress && <span>{item.progress}</span>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

type MessagesTab = "dm" | "news";

/** 消息（T）：私信和新闻；四个频道的完整版在 U4 */
export function MessagesPage({
  view,
  onReply,
  onMessageNpc,
  onSendChat,
  onReadThread,
  onReadCall,
  chatSending,
  pendingChat,
  busy,
  onLocatePlace,
  onOpenRipperdoc,
  onNews,
  initialTab = "dm",
  hideTabs = false,
}: {
  readonly view: View;
  /** 切到新闻栏：把新闻记成已读 */
  readonly onNews: () => void;
  readonly initialTab?: MessagesTab;
  /** 外面已经有页签（钉住的未读块）时不再出页内分栏 */
  readonly hideTabs?: boolean;
} & PhoneActions) {
  const [tab, setTab] = useState<MessagesTab>(initialTab);
  const actions: PhoneActions = {
    onReply,
    onMessageNpc,
    onSendChat,
    onReadThread,
    onReadCall,
    chatSending,
    pendingChat,
    busy,
    onLocatePlace,
    onOpenRipperdoc,
  };
  return (
    <>
      {!hideTabs && (
        <SubTabs<MessagesTab>
          tabs={[
            ["dm", view.phone.unread > 0 ? `私信 ${view.phone.unread}` : "私信"],
            ["news", "新闻"],
          ]}
          value={tab}
          onChange={(t) => {
            setTab(t);
            if (t === "news") onNews();
          }}
        />
      )}
      {hideTabs ? (
        tab === "dm" ? (
          <PhoneBody view={view} {...actions} />
        ) : (
          <NewsBody view={view} />
        )
      ) : (
        <Panel as="section" title={tab === "dm" ? "私信" : "新闻"} line="var(--cp-cyan)" frame>
          {tab === "dm" ? <PhoneBody view={view} {...actions} /> : <NewsBody view={view} />}
        </Panel>
      )}
    </>
  );
}

type ContactsTab = "people" | "squad" | "factions";

/** 联系人：人物档案（含宿敌）、小队、势力 */
export function ContactsPage({
  view,
  onSquad,
}: {
  readonly view: View;
  /** 小队的动作；正在生成时不传，按钮不显示 */
  readonly onSquad?: ((action: SquadAction, npc: string) => void) | undefined;
}) {
  const [tab, setTab] = useState<ContactsTab>("people");
  const people = view.npcs.filter((n) => n.met || n.nemesis || n.known.length > 0);
  const [picked, setPicked] = useState<string | null>(null);
  const current = people.find((n) => n.id === picked) ?? people[0];

  return (
    <>
      <SubTabs<ContactsTab>
        tabs={[
          ["people", "人物"],
          ["squad", `小队 ${view.squad.members.length}/${view.squad.max}`],
          ["factions", "势力"],
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "people" &&
        (people.length === 0 || !current ? (
          <p className={styles.dim}>还没有认识的人。</p>
        ) : (
          <div className={neural.split}>
            <Panel as="section" title="人物" line="var(--cp-cyan)">
              <ul className={styles.contactList} aria-label="人物">
                {people.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      className={styles.contact}
                      aria-pressed={n.id === current.id}
                      onClick={() => setPicked(n.id)}
                    >
                      <Avatar npc={n.id} name={n.name} dead={!n.alive} />
                      <span className={styles.contactName}>
                        <b>{n.name}</b>
                        <small className={styles.dim}>
                          {!n.alive
                            ? "已故"
                            : n.met
                              ? `${n.role} · 好感 ${n.affinity > 0 ? "+" : ""}${n.affinity}${n.behaviorChip ? ` · ${n.behaviorChip.label}` : ""}`
                              : n.nemesis
                                ? "交过手"
                                : "只听说过"}
                        </small>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </Panel>
            <Profile npc={current} fixer={view.jobs.fixers.find((f) => f.id === current.id)} />
          </div>
        ))}
      {tab === "squad" && <SquadPanel squad={view.squad} onSquad={onSquad} />}
      {tab === "factions" && (
        <Panel as="section" title="势力" line="var(--cp-yellow)">
          <FactionsBody view={view} />
        </Panel>
      )}
    </>
  );
}

/** 资料与超梦回看档案：专管已读芯片原文（实体片转交后仍保留）与超梦三层轨道线索；随身实体芯片与 2 个神经插槽归属物品栏。 */
export function ShardsPanel({
  view,
  onReadShard,
}: {
  readonly view: View;
  /** 打开已归档原文：仅标记界面已浏览 */
  readonly onReadShard: (id: number) => void;
}) {
  const [tab, setTab] = useState<"archive" | "braindance">("archive");
  const archiveCount = view.shards.list.length;
  const bdCount = view.braindance.works.length;
  return (
    <div className={mediaStyles.archive}>
      <nav className={mediaStyles.tabs} aria-label="已读资料与超梦回看">
        <Button small pressed={tab === "archive"} onClick={() => setTab("archive")}>
          已读资料 · {archiveCount}
          {view.shards.unread > 0 ? `（${view.shards.unread} 新）` : ""}
        </Button>
        <Button small pressed={tab === "braindance"} onClick={() => setTab("braindance")}>
          超梦回看 · {bdCount}
          {view.braindance.active ? " · 进行中" : ""}
        </Button>
      </nav>
      {tab === "archive" ? (
        <ChipArchive view={view} onReadShard={onReadShard} />
      ) : (
        <BraindanceArchive view={view} />
      )}
    </div>
  );
}

type ChipCategoryFilter = "all" | "intel" | "daemon" | "skill" | "braindance" | "behavior";

const CHIP_CATEGORY_TABS: readonly (readonly [ChipCategoryFilter, string])[] = [
  ["all", "全部"],
  ["intel", "情报"],
  ["daemon", "加密与陷阱"],
  ["skill", "技能协议"],
  ["braindance", "超梦载体"],
  ["behavior", "行为协议"],
];

/** 已读芯片原文归档：仅保留读过的长文与多媒体，避免与物品栏里的实体芯片重复。 */
function ChipArchive({
  view,
  onReadShard,
}: {
  readonly view: View;
  readonly onReadShard: (id: number) => void;
}) {
  const shards = view.shards.list;
  const [category, setCategory] = useState<ChipCategoryFilter>("all");
  const [pickedId, setPickedId] = useState<number | null>(null);

  const filteredShards = shards.filter((s) => category === "all" || s.category === category);
  const selectedShard =
    (pickedId !== null ? filteredShards.find((s) => s.id === pickedId) : undefined) ??
    filteredShards[0] ??
    null;

  const openShard = (id: number, read: boolean) => {
    setPickedId(id);
    if (!read) onReadShard(id);
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateRows: "auto minmax(0, 1fr)",
        minHeight: 0,
        height: "100%",
      }}
    >
      <nav className={mediaStyles.tabs} aria-label="资料分类筛选">
        {CHIP_CATEGORY_TABS.map(([id, label]) => (
          <Button
            key={id}
            small
            pressed={category === id}
            onClick={() => {
              setCategory(id);
              setPickedId(null);
            }}
          >
            {label}
          </Button>
        ))}
      </nav>

      {filteredShards.length === 0 ? (
        <div className={styles.phoneEmpty}>
          <p className={styles.dim}>
            {shards.length === 0
              ? "还没有已读归档资料。随身实体芯片与 2 个神经插槽请在右下角「物品栏 → 芯片与超梦」查看；读过的芯片正文会永久留档在这里，哪怕把实体芯片交给别人也能回看。"
              : "当前分类下暂无已读资料。"}
          </p>
        </div>
      ) : (
        <div className={styles.dbSplit}>
          <ul className={`${styles.contactList} ${styles.dbList}`} aria-label="已读资料目录">
            {filteredShards.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className={styles.contact}
                  aria-pressed={selectedShard?.id === s.id}
                  onClick={() => openShard(s.id, s.read)}
                >
                  <span className={styles.contactName}>
                    <b>{s.title}</b>
                    <small className={styles.dim}>
                      {s.categoryLabel} · {s.at}
                    </small>
                  </span>
                  {!s.read && <UnreadBadge>新</UnreadBadge>}
                </button>
              </li>
            ))}
          </ul>

          <article className={styles.dbReader}>
            {selectedShard ? (
              <>
                <h3 className={styles.dbReaderTitle}>{selectedShard.title}</h3>
                <p className={styles.dim}>
                  {selectedShard.categoryLabel} · {selectedShard.kindLabel}
                  {selectedShard.from && ` · 来源：${selectedShard.from}`} · {selectedShard.at}
                </p>
                <p className={styles.factionReason}>
                  <InlineContentText text={selectedShard.text} />
                </p>
                <ContentMediaList media={selectedShard.media ?? []} />
              </>
            ) : (
              <p className={styles.dim}>从左侧选择一份已读资料查看原文。</p>
            )}
          </article>
        </div>
      )}
    </div>
  );
}

function tierBadgeClass(tier: string): string {
  const base = mediaStyles.badge ?? "";
  if (tier === "xbd") return `${base} ${mediaStyles.badgeDanger ?? ""}`.trim();
  if (tier === "raw" || tier === "sensory") return `${base} ${mediaStyles.badgeWarn ?? ""}`.trim();
  return base;
}

/** 超梦台：展示当前活跃超梦会话、分级徽章、三层感官轨道扫描状态、已揭示线索卡与片段回看。 */
function BraindanceArchive({ view }: { readonly view: View }) {
  const { active, works, discoveries } = view.braindance;
  const [pickedWork, setPickedWork] = useState<string | null>(active?.work ?? null);
  const currentWork = works.find((w) => w.id === pickedWork) ?? works[0] ?? null;
  const workDiscoveries = currentWork ? discoveries.filter((d) => d.work === currentWork.id) : [];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateRows: active ? "auto minmax(0, 1fr)" : "minmax(0, 1fr)",
        minHeight: 0,
        height: "100%",
      }}
    >
      {active && (
        <section className={mediaStyles.slotStrip} aria-label="当前播放超梦">
          <div className={mediaStyles.slotHeader}>
            <strong>
              正在体验：《{active.title}》 · {active.modeLabel}
            </strong>
            <span className={tierBadgeClass(active.tier)}>{active.tierLabel}</span>
          </div>
          <p className={styles.dim}>
            录制者：{active.recorder} · 进度 {active.watchedMinutes}/{active.durationMinutes} 分钟 ·
            开始于 {active.startedAt}
          </p>
          <div className={mediaStyles.layerGrid}>
            {active.layers.map((layer) => (
              <div
                key={layer.layer}
                className={`${mediaStyles.layerCell} ${
                  layer.total > 0 && layer.found >= layer.total ? mediaStyles.layerCellDone : ""
                }`}
              >
                <strong>{layer.label}</strong>
                <span className={styles.dim}>
                  {layer.total > 0 ? `已扫描线索 ${layer.found}/${layer.total}` : "无隐藏线索"}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {!currentWork ? (
        <div className={styles.phoneEmpty}>
          <p className={styles.dim}>
            还没有体验或扫描过的超梦卷轴。前往丽姿酒吧、阿岚小铺或佩戴超梦花环播放后，定稿片段与三层轨道线索会留在这里。
          </p>
        </div>
      ) : (
        <div className={styles.dbSplit}>
          <ul className={`${styles.contactList} ${styles.dbList}`} aria-label="超梦卷轴目录">
            {works.map((work) => {
              const foundTotal = work.layers.reduce((sum, l) => sum + l.found, 0);
              const clueTotal = work.layers.reduce((sum, l) => sum + l.total, 0);
              return (
                <li key={work.id}>
                  <button
                    type="button"
                    className={styles.contact}
                    aria-pressed={work.id === currentWork.id}
                    onClick={() => setPickedWork(work.id)}
                  >
                    <span className={styles.contactName}>
                      <b>{work.title}</b>
                      <span className={mediaStyles.badgeRow}>
                        <span className={tierBadgeClass(work.tier)}>{work.tierLabel}</span>
                        {clueTotal > 0 && (
                          <span className={mediaStyles.badge}>
                            线索 {foundTotal}/{clueTotal}
                          </span>
                        )}
                        {work.passages.length > 0 && (
                          <span className={mediaStyles.badge}>
                            已回看 {work.passages.length} 段
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <article className={styles.dbReader} key={currentWork.id}>
            <h3 className={styles.dbReaderTitle}>{currentWork.title}</h3>
            <div className={mediaStyles.badgeRow}>
              <span className={tierBadgeClass(currentWork.tier)}>{currentWork.tierLabel}</span>
              <span className={styles.dim}>
                录制者：{currentWork.recorder} · 时长 {currentWork.durationMinutes} 分钟
              </span>
            </div>
            <p className={styles.factionReason}>{currentWork.synopsis}</p>
            {currentWork.xbdRisk && (
              <p className={mediaStyles.error}>神经警示：{currentWork.xbdRisk}</p>
            )}

            {currentWork.layers.some((l) => l.total > 0) && (
              <section className={mediaStyles.group}>
                <h4 className={mediaStyles.groupTitle}>三层感官轨道扫描状态</h4>
                <div className={mediaStyles.layerGrid}>
                  {currentWork.layers.map((layer) => (
                    <div
                      key={layer.layer}
                      className={`${mediaStyles.layerCell} ${
                        layer.total > 0 && layer.found >= layer.total
                          ? mediaStyles.layerCellDone
                          : ""
                      }`}
                    >
                      <strong>{layer.label}</strong>
                      <span className={styles.dim}>
                        {layer.total > 0 ? `${layer.found}/${layer.total}` : "—"}
                      </span>
                    </div>
                  ))}
                </div>
                {workDiscoveries.length > 0 ? (
                  <ul className={mediaStyles.clueList} aria-label="已揭示线索">
                    {workDiscoveries.map((clue) => (
                      <li key={`${clue.work}:${clue.detail}`} className={mediaStyles.clueItem}>
                        <div className={mediaStyles.badgeRow}>
                          <span className={mediaStyles.badge}>{clue.layerLabel}</span>
                          <span className={styles.dim}>{clue.at}</span>
                        </div>
                        <p style={{ margin: "4px 0 0" }}>{clue.finding}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={styles.dim}>尚未在编辑模式下扫描出轨道线索。</p>
                )}
              </section>
            )}

            {currentWork.passages.length > 0 && (
              <section className={mediaStyles.group}>
                <h4 className={mediaStyles.groupTitle}>已体验片段回看</h4>
                {currentWork.passages.map((passage) => (
                  <div key={passage.id} className={mediaStyles.group}>
                    <p className={styles.dim}>{passage.label}</p>
                    <p className={styles.factionReason}>
                      <InlineContentText text={passage.text} />
                    </p>
                    <ContentMediaList media={passage.media ?? []} />
                  </div>
                ))}
              </section>
            )}
          </article>
        </div>
      )}
    </div>
  );
}
