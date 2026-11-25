import { characterRules, cyberwareRules, type PlayerAction } from "@cp/core";
import { type CSSProperties, type ReactNode, useState } from "react";
import { Button } from "../../ui/Button";
import { CellFrame } from "../../ui/FrameBox";
import { Panel } from "../../ui/Panel";
import { BiomonitorPanel } from "./BiomonitorPanel";
import { ContentMediaList, InlineContentText } from "./ContentMedia";
import { CYBER_LABELS, CyberDoll, CyberItemCell, type CyberSlot } from "./CyberDoll";
import mediaStyles from "./content-media.module.css";
import { rarityLabelOf, rarityTintOf } from "./cyberwareMeta";
import { type HabitAction, Habits } from "./Habits";
import { NewsBody } from "./NewsPanel";
import neural from "./neural.module.css";
import { type PhoneActions, PhoneBody, UnreadBadge } from "./Phone";
import styles from "./story.module.css";
import type { View } from "./view";

/**
 * 神经界面里由旧左侧栏拆出来的几页（2077-interface-plan.md 第五节第 4 条）：
 * 人物、义体、消息、联系人、资料与超梦档案；物品栏与追踪面板已迁至独立模块 InventoryPage / TrackerPanel。
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
      {character.deeds.length > 0 && (
        <section className={styles.habits} aria-label="外界知道的事">
          <h4 className={styles.habitsTitle}>外界知道的事 · {character.reputationLabel}</h4>
          <ul className={styles.habitList}>
            {[...character.deeds].reverse().map((deed) => {
              const scope =
                deed.reach === "city"
                  ? deed.reachLabel
                  : deed.district
                    ? `${deed.district}·${deed.reachLabel}`
                    : deed.reachLabel;
              const meta =
                deed.knownBy.length > 0 ? `${scope} · ${deed.knownBy.join("、")}` : scope;
              return (
                <li key={deed.id} className={styles.habitItem}>
                  <span className={styles.habitText}>{deed.summary}</span>
                  <small>{meta}</small>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <Habits habits={character.habits} offers={character.habitOffers} onHabit={onHabit} />
    </div>
  );
}

type CyberPart = View["cyberware"][number];

function cyberLoadTag(cost: number): { readonly label: string; readonly tone?: "ok" | "warn" } {
  if (cost <= 0) return { label: "零负荷", tone: "ok" };
  if (cost >= 10) return { label: "高压核心", tone: "warn" };
  if (cost >= 5) return { label: "中负荷" };
  return { label: "轻负荷" };
}

/** 义体（新版自由装配布局：顶部纯事实负荷与神经遥测 + 居中人体拓扑 + 右侧常驻部位详情台） */
export function CyberwarePage({
  view,
  onRipperdoc,
}: {
  readonly view: View;
  readonly onRipperdoc: () => void;
}) {
  const bySlot = new Map<CyberSlot, CyberPart[]>();
  for (const c of view.cyberware) bySlot.set(c.slot, [...(bySlot.get(c.slot) ?? []), c]);

  const initialSlot: CyberSlot = view.cyberware[0]?.slot ?? "os";
  const [activeSlot, setActiveSlot] = useState<CyberSlot>(initialSlot);

  const brokenItems = view.cyberware.filter((c) => c.broken);
  const firstBroken = brokenItems[0];
  const brokenCount = brokenItems.length;
  const load = cyberwareRules.cyberwareLoadProfile(
    view.cyberware
      .filter((c) => !c.broken)
      .map((c) => ({
        id: c.id,
        name: c.name,
        slot: c.slot,
        humanityCost: c.humanityCost,
        iconic: c.iconic,
        armor: c.armor,
        accelerator: c.accelerator,
        ...(c.deckProfile ? { deckProfile: c.deckProfile } : {}),
        ...(c.deckTraits ? { deckTraits: c.deckTraits } : {}),
        ...(c.exclusiveGroup ? { exclusiveGroup: c.exclusiveGroup } : {}),
      })),
  );

  const slotItems = bySlot.get(activeSlot) ?? [];
  const neuralBad = !view.humanity.suppressed && view.humanity.stage !== "stable";

  const slotNote = (() => {
    if (activeSlot === "arms" && slotItems.length > 0) {
      if (slotItems.length >= 2) return "左右臂混搭（2/2）· 双臂各自搭载一套义臂";
      return slotItems[0] && cyberwareRules.isSingleArmCyberware(slotItems[0].id)
        ? "单臂装配 · 另一只手臂空闲，可再混搭 1 件"
        : "双臂成对生效 · 再装第 2 件臂部义体自动改左右混搭";
    }
    if (activeSlot === "eyes") {
      const mainOptic = slotItems.find(
        (p) =>
          cyberwareRules.cyberwareExclusiveGroup({
            id: p.id,
            name: p.name,
            slot: "eyes",
            ...(p.exclusiveGroup ? { exclusiveGroup: p.exclusiveGroup } : {}),
          }) === "optics",
      );
      if (mainOptic) {
        return `主义眼「${mainOptic.name}」双眼成对 · 耳/鼻/虹膜/面甲等感官件可自由叠加`;
      }
    }
    if (activeSlot === "legs") {
      const mainLeg = slotItems.find(
        (p) =>
          cyberwareRules.cyberwareExclusiveGroup({
            id: p.id,
            name: p.name,
            slot: "legs",
            ...(p.exclusiveGroup ? { exclusiveGroup: p.exclusiveGroup } : {}),
          }) === "legDrive",
      );
      if (mainLeg) {
        return `「${mainLeg.name}」双腿成对驱动 · 猫爪/磁吸/暗格等附挂件可自由叠加`;
      }
    }
    return "不限部位格数 · 仅按物理互斥";
  })();

  return (
    <div className={neural.cyberPage}>
      {/* 顶部：精简 HUD 遥测条（去重框，纯键值读数 + 医生直达） */}
      <section
        className={neural.cyberTelemetry}
        data-tone={load.tone}
        aria-label="全身义体负荷与神经状态"
      >
        <div className={neural.cyberTelemetryMain}>
          <div className={neural.cyberMetrics}>
            <span className={neural.cyberMetric} data-tone={load.tone}>
              <small>负荷</small>
              <b>{load.label}</b>
            </span>
            <span className={neural.cyberMetricSep} aria-hidden />
            <span className={neural.cyberMetric} data-tone={neuralBad ? "bad" : "ok"}>
              <small>神经</small>
              <b>
                {view.humanity.stageLabel}
                {view.humanity.suppressed ? "·压制" : ""}
              </b>
            </span>
            <span className={neural.cyberMetricSep} aria-hidden />
            <span className={neural.cyberMetric}>
              <small>已装</small>
              <b>{view.cyberware.length} 件</b>
            </span>
            {load.zeroLoadCount > 0 && (
              <>
                <span className={neural.cyberMetricSep} aria-hidden />
                <span className={neural.cyberMetric} data-tone="ok">
                  <small>零负荷</small>
                  <b>{load.zeroLoadCount}</b>
                </span>
              </>
            )}
            {load.dualCore && (
              <span className={neural.cyberStatusFlag} data-tone="warn">
                双中枢并行
              </span>
            )}
            {load.fullBorg && (
              <span className={neural.cyberStatusFlag} data-tone="bad">
                全身义体化
              </span>
            )}
            {firstBroken && (
              <button
                type="button"
                className={neural.cyberPillBtn}
                data-tone="bad"
                onClick={() => setActiveSlot(firstBroken.slot)}
              >
                损毁待修 {brokenCount} →
              </button>
            )}
            {view.health.lostLimbs.length > 0 && (
              <span className={neural.cyberStatusFlag} data-tone="bad">
                断肢：{view.health.lostLimbs.map((l) => l.label).join("、")}
              </span>
            )}
          </div>
          <p className={neural.cyberTelemetrySummary}>{load.summary}</p>
          {view.humanity.symptoms.length > 0 && (
            <p className={neural.cyberSymptomLine}>
              活跃症状：
              {view.humanity.symptoms.map((s) => `${s.description}（${s.cause}）`).join("；")}
            </p>
          )}
        </div>
        {view.ripperdoc && (
          <div className={neural.cyberTelemetryAct}>
            <Button small primary onClick={onRipperdoc}>
              义体医生 · {view.ripperdoc.name}
            </Button>
          </div>
        )}
      </section>

      {/* 主双栏：左开放式人体扫描拓扑 + 右细线分隔部位详情 */}
      <div className={neural.cyberLayout}>
        <section className={neural.cyberDollPane} aria-label="人体解剖拓扑">
          <div className={neural.cyberDollStage}>
            <CyberDoll
              parts={bySlot}
              selected={activeSlot}
              onCell={(slot) => setActiveSlot(slot)}
            />
          </div>
        </section>

        <aside className={neural.cyberInspector} aria-label="当前部位义体详情">
          <header className={neural.cyberInspectorHead}>
            <div className={neural.cyberInspectorTitleRow}>
              <strong className={neural.cyberInspectorTitle}>{CYBER_LABELS[activeSlot]}</strong>
              <span className={neural.cyberInspectorCount}>
                {String(slotItems.length).padStart(2, "0")}
              </span>
            </div>
            <p className={neural.cyberInspectorNote}>{slotNote}</p>
          </header>

          <div className={neural.cyberInspectorScroll}>
            {slotItems.length === 0 ? (
              <div className={neural.cyberEmptyBox}>
                <strong>尚未装配{CYBER_LABELS[activeSlot]}义体</strong>
                <p>
                  {view.ripperdoc
                    ? `可在「${view.ripperdoc.name}」的诊所自由加装；除物理互斥核心外，该部位不设固定格数上限。`
                    : "前往任意义体医生诊所即可自由加装；感官、时尚、生活与暗格类义体零神经负荷。"}
                </p>
                {view.ripperdoc && (
                  <Button small primary onClick={onRipperdoc}>
                    打开 {view.ripperdoc.name} 诊所
                  </Button>
                )}
              </div>
            ) : (
              <ul className={neural.cyberCardList}>
                {slotItems.map((part) => {
                  const rarityLabel = rarityLabelOf(part.rarity, part.iconic);
                  const tint = part.broken
                    ? "var(--cp-danger)"
                    : rarityTintOf(part.rarity, part.iconic);
                  const loadTag = cyberLoadTag(part.humanityCost);
                  const mountHint = cyberwareRules.cyberwareMountHint(
                    {
                      id: part.id,
                      name: part.name,
                      slot: part.slot,
                      armor: part.armor,
                      accelerator: part.accelerator,
                      ...(part.deckProfile ? { deckProfile: part.deckProfile } : {}),
                      ...(part.deckTraits ? { deckTraits: part.deckTraits } : {}),
                      ...(part.exclusiveGroup ? { exclusiveGroup: part.exclusiveGroup } : {}),
                    },
                    part.slot === "arms" ? slotItems.length : 0,
                  );
                  return (
                    <li
                      key={part.id}
                      className={neural.cyberDetailCard}
                      data-broken={part.broken || undefined}
                      style={{ "--card-tint": tint } as CSSProperties}
                    >
                      <div className={neural.cyberDetailTop}>
                        <CyberItemCell
                          id={part.id}
                          name={part.name}
                          slot={part.slot}
                          rarity={part.rarity ?? undefined}
                          iconic={part.iconic}
                          broken={part.broken}
                          on={!part.broken}
                          size={44}
                        />
                        <div className={neural.cyberDetailMeta}>
                          <div className={neural.cyberDetailTitleRow}>
                            <strong className={neural.cyberDetailName}>{part.name}</strong>
                            {part.broken && (
                              <span className={neural.cyberStatusFlag} data-tone="bad">
                                已损毁
                              </span>
                            )}
                          </div>
                          <div className={neural.cyberDetailSpecLine}>
                            {rarityLabel && (
                              <span className={neural.cyberSpecItem} style={{ color: tint }}>
                                {rarityLabel}
                              </span>
                            )}
                            <span className={neural.cyberSpecItem} data-tone={loadTag.tone}>
                              {loadTag.label}
                            </span>
                            <span
                              className={neural.cyberSpecItem}
                              data-tone={
                                mountHint ? "warn" : part.exclusiveGroupLabel ? undefined : "ok"
                              }
                            >
                              {mountHint?.badge ?? part.exclusiveGroupLabel ?? "可自由叠加"}
                            </span>
                          </div>
                        </div>
                      </div>

                      {part.ability && <p className={neural.cyberDetailDesc}>{part.ability}</p>}

                      {!part.broken &&
                        (part.deckProfile || (part.deckTraits && part.deckTraits.length > 0)) && (
                          <p className={neural.cyberDetailSub}>
                            接入仓特化：
                            {[part.deckTraits?.join(" · "), part.deckProfile]
                              .filter(Boolean)
                              .join(" — ")}
                          </p>
                        )}

                      {part.behaviorChip && (
                        <p className={neural.cyberDetailSub}>
                          {[
                            `行为芯片：${part.behaviorChip.label}`,
                            part.behaviorChip.protocol
                              ? `协议：${part.behaviorChip.protocol}`
                              : null,
                            part.behaviorChip.memoryGap ? "存在托管记忆断层" : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>
      </div>
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

type MessagesTab = "dm" | "news";

/** 消息（T）：私信和新闻；四个频道的完整版在 U4 */
export function MessagesPage({
  view,
  onReply,
  onMessageNpc,
  onSendChat,
  onReadThread,
  onReadCall,
  onAnswerCall,
  onAcceptJob,
  chatSending,
  pendingChat,
  busy,
  onLocatePlace,
  onOpenRipperdoc,
  onOpenPeople,
  focusContact,
  onConsumeFocus,
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
    onAnswerCall,
    onAcceptJob,
    chatSending,
    pendingChat,
    busy,
    onLocatePlace,
    onOpenRipperdoc,
    onOpenPeople,
    focusContact,
    onConsumeFocus,
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

/** 资料与超梦回看档案：只保留「情报」与「超梦」两栏；随身实体芯片与 2 个神经插槽归属物品栏。 */
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
      <nav className={mediaStyles.tabs} aria-label="资料分区">
        <Button small pressed={tab === "archive"} onClick={() => setTab("archive")}>
          情报 · {archiveCount}
          {view.shards.unread > 0 ? `（${view.shards.unread} 新）` : ""}
        </Button>
        <Button small pressed={tab === "braindance"} onClick={() => setTab("braindance")}>
          超梦 · {bdCount}
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

const ARCHIVE_SEARCH_THRESHOLD = 6;

/** 情报归档：保留读过的芯片原文与多媒体，条目达到阈值后显示轻量筛选框。 */
function ChipArchive({
  view,
  onReadShard,
}: {
  readonly view: View;
  readonly onReadShard: (id: number) => void;
}) {
  const shards = view.shards.list;
  const [query, setQuery] = useState("");
  const [pickedId, setPickedId] = useState<number | null>(null);

  const showSearch = shards.length >= ARCHIVE_SEARCH_THRESHOLD;
  const keyword = showSearch ? query.trim().toLocaleLowerCase() : "";
  const filteredShards = keyword
    ? shards.filter((s) =>
        `${s.title}\n${s.from ?? ""}\n${s.kindLabel}\n${s.text}`
          .toLocaleLowerCase()
          .includes(keyword),
      )
    : shards;
  const selectedShard =
    (pickedId !== null ? filteredShards.find((s) => s.id === pickedId) : undefined) ??
    filteredShards[0] ??
    null;

  const openShard = (id: number, read: boolean) => {
    setPickedId(id);
    if (!read) onReadShard(id);
  };

  if (shards.length === 0) {
    return (
      <div className={styles.phoneEmpty}>
        <p className={styles.dim}>
          还没有已读情报。随身实体芯片与神经插槽请在「物品栏」查看；读过的芯片原文会永久留档在这里，哪怕把实体芯片交给别人也能回看。
        </p>
      </div>
    );
  }

  const listItems = (
    <ul className={`${styles.contactList} ${styles.dbList}`} aria-label="情报目录">
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
                {s.kindLabel}
                {s.from ? ` · ${s.from}` : ` · ${s.at}`}
              </small>
            </span>
            {!s.read && <UnreadBadge>新</UnreadBadge>}
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <div className={styles.dbSplit}>
      {showSearch ? (
        <div className={mediaStyles.archiveSide}>
          <div className={mediaStyles.archiveSearch}>
            <CellFrame />
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPickedId(null);
              }}
              placeholder="筛选标题、来源或正文…"
              aria-label="筛选情报"
              className={mediaStyles.archiveSearchInput}
            />
            {query && (
              <button
                type="button"
                className={mediaStyles.archiveSearchClear}
                aria-label="清空筛选"
                onClick={() => {
                  setQuery("");
                  setPickedId(null);
                }}
              >
                ×
              </button>
            )}
          </div>
          {filteredShards.length > 0 ? (
            listItems
          ) : (
            <p className={mediaStyles.archiveNoMatch}>没有匹配「{query.trim()}」的情报。</p>
          )}
        </div>
      ) : (
        listItems
      )}

      <article className={styles.dbReader}>
        {selectedShard ? (
          <>
            <h3 className={styles.dbReaderTitle}>{selectedShard.title}</h3>
            <p className={styles.dim}>
              {selectedShard.kindLabel}
              {selectedShard.from && ` · 来源：${selectedShard.from}`} · {selectedShard.at}
            </p>
            <p className={styles.factionReason}>
              <InlineContentText text={selectedShard.text} />
            </p>
            <ContentMediaList media={selectedShard.media ?? []} />
          </>
        ) : (
          <p className={styles.dim}>
            {keyword ? "没有匹配当前关键词的情报。" : "从左侧选择一条情报查看原文。"}
          </p>
        )}
      </article>
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
            还没有体验或扫描过的超梦卷轴。前往丽姿酒吧、洋子芯片铺或佩戴超梦花环播放后，定稿片段与三层轨道线索会留在这里。
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
