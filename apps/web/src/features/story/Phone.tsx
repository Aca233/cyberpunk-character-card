import { useEffect, useRef, useState } from "react";
import { ActionButton } from "../../ui/ActionButton";
import { Asset, cssUrl, NineSlice } from "../../ui/Asset";
import { CellFrame } from "../../ui/FrameBox";
import { useLayer } from "../../ui/layers";
import { GeneratedImage } from "../images/GeneratedImage";
import { useSaveImages } from "../images/SaveImagesContext";
import { portraitOf } from "./art";
import { ProfileHead } from "./Profile";
import styles from "./story.module.css";
import {
  buildChatBubbles,
  type ContactFilter,
  type ContactSummary,
  contactDirectory,
  urgentChatDeadline,
  type View,
} from "./view";

type PhoneMessage = View["phone"]["messages"][number];

const CELL_SLICE = [20, 30, 30, 20] as const;

const FILTER_OPTIONS: readonly {
  readonly id: ContactFilter;
  readonly label: string;
  readonly match: (c: ContactSummary) => boolean;
}[] = [
  { id: "all", label: "全部", match: () => true },
  { id: "active", label: "有事", match: (c) => c.isActive },
  { id: "utility", label: "渠道", match: (c) => c.isUtility },
  { id: "present", label: "在场", match: (c) => c.isPresent },
];

/** 头像：有原作头像（avatars 图集）的人物用原作图，没有的（曼因、丽贝卡、法拉第等）用名字的第一个字；框用原作 map.filterCell* */
export function Avatar({
  name,
  dead,
  npc,
}: {
  readonly name: string;
  readonly dead: boolean;
  /** 人物 id；不传或没有原作头像时退回名字的第一个字 */
  readonly npc?: string | undefined;
}) {
  const saveImages = useSaveImages();
  const customId = npc ? (saveImages?.bindings.npcs[npc] ?? null) : null;
  const portrait = portraitOf(npc);
  return (
    <span
      className={styles.avatar}
      data-dead={dead || undefined}
      data-portrait={customId || portrait ? true : undefined}
      aria-hidden="true"
    >
      <NineSlice
        id="map.filterCellBg"
        tint="var(--box-fill, rgb(14 14 23 / 78%))"
        slice={CELL_SLICE}
      />
      {customId ? (
        <GeneratedImage
          imageId={customId}
          alt={name}
          className={styles.avatarArt}
          fallback={
            portrait ? (
              <Asset id={portrait} className={styles.avatarArt} />
            ) : (
              <b className={styles.avatarGlyph}>{[...name][0] ?? "?"}</b>
            )
          }
        />
      ) : portrait ? (
        <Asset id={portrait} className={styles.avatarArt} />
      ) : (
        <b className={styles.avatarGlyph}>{[...name][0] ?? "?"}</b>
      )}
      <NineSlice
        id="map.filterCellFg"
        tint="var(--box-line, var(--cp-cyan-dim))"
        slice={CELL_SLICE}
      />
    </span>
  );
}

/** 未读角标（计划第十二节第 9 条）：联系人和芯片共用原作数字格，四边保留 16 原图像素，字数增加时只拉伸中间 */
export function UnreadBadge({ children }: { readonly children: string | number }) {
  return (
    <span className={styles.contactUnread}>
      <NineSlice id="dialog.numberSlot" tint="var(--cp-yellow)" slice={16} />
      {children}
    </span>
  );
}

/** 浮层照原作世界地图默认 tooltip 的三层（阴影、底、框），切线同 MapPanel 的 TOOLTIP_SLICE / SHADOW_SLICE */
const TIP_SLICE = [10, 30, 70, 10] as const;
const TIP_SHADOW_SLICE = 20;

/** 联系人的好感数字：正数带加号 */
function affinityLabel(n: number): string {
  return `好感 ${n > 0 ? "+" : ""}${n}`;
}

/** 正在等待服务器返回的一条本地乐观聊天 */
export interface PendingPhoneChat {
  readonly contact: string;
  readonly text: string;
}

/** 手机直聊单次发送结果：失败时把具体错误回传到输入框旁就地展示 */
export type PhoneSendResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };

/** 联系人公共操作回调：手机窗口内直聊、标已读、回复进主线、地图定位、直开诊所/商店 */
export interface PhoneActions {
  /** 回复一条（填入下方行动输入框）；正在生成或已结束时不传，按钮不显示 */
  readonly onReply?: ((id: number) => void) | undefined;
  /** 主动给人物发一条填入下方行动输入框的私信 */
  readonly onMessageNpc?: ((id: string, name: string) => void) | undefined;
  /** 在手机窗口内直接发送私信（调辅助模型并推进 1–3 分钟）；返回发送结果 */
  readonly onSendChat?: ((contact: string, text: string) => Promise<PhoneSendResult>) | undefined;
  /** 切到某个联系人且其有未读短信时，只把该联系人名下的未读消息标已读 */
  readonly onReadThread?: ((unreadIds: readonly number[]) => void) | undefined;
  /** 正在等待哪位联系人的手机直聊回复 */
  readonly chatSending?: string | null | undefined;
  /** 本地乐观展示的发送中消息 */
  readonly pendingChat?: PendingPhoneChat | null | undefined;
  /** 主线回合是否正在生成 */
  readonly busy?: boolean | undefined;
  /** 地图定位到人物所在地点 */
  readonly onLocatePlace?: ((placeId: string) => void) | undefined;
  /** 就在对方诊所时直接打开义体诊所界面 */
  readonly onOpenRipperdoc?: (() => void) | undefined;
  /** 就在对方摊位/店面时直接打开商店界面 */
  readonly onOpenShop?: ((shopId: string) => void) | undefined;
}

function latestUnreadMessage(thread: readonly PhoneMessage[]): PhoneMessage | undefined {
  for (let i = thread.length - 1; i >= 0; i -= 1) {
    const msg = thread[i];
    if (msg && msg.sender !== "player" && !msg.read) return msg;
  }
  return undefined;
}

/** 结构性禁用直聊的原因（不包含短暂等待发送，避免发送期间卸载输入框丢焦点） */
function inlineChatLockReason(
  contact: ContactSummary,
  view: View,
  actions: Pick<PhoneActions, "onSendChat" | "busy">,
): string | null {
  if (view.death || view.ended) return "故事已结束，频道仅可回看";
  if (view.combat?.active) return "正在交火，先脱身或解决眼前这架再发消息";
  if (!contact.npc) return "匿名加密频道暂不支持私聊，可点上方消息「回复」在行动框里处理";
  if (!contact.npc.met) return `还没正式见过 ${contact.name}，先在剧情里打过照面`;
  if (!contact.npc.alive) return `${contact.name} 的终端已离线`;
  if (actions.busy) return "行动回合正在生成，请稍候";
  if (!actions.onSendChat) return "当前暂不可发送私信";
  return null;
}

function computeFilterTabs(contacts: readonly ContactSummary[]) {
  const counts: Record<ContactFilter, number> = {
    all: contacts.length,
    active: 0,
    utility: 0,
    present: 0,
  };
  for (const c of contacts) {
    if (c.isActive) counts.active += 1;
    if (c.isUtility) counts.utility += 1;
    if (c.isPresent) counts.present += 1;
  }
  return {
    counts,
    tabs: FILTER_OPTIONS.filter((opt) => opt.id === "all" || counts[opt.id] > 0).map((opt) => ({
      ...opt,
      count: counts[opt.id],
    })),
  };
}

/** 联系人左栏卡片：简洁双行——顶行「姓名 + 在场圆点 + 首要职能短牌」，底行「未读预览 / 关键待办 / 一句话用途」 */
function ContactRow({
  contact,
  active,
  onSelect,
}: {
  readonly contact: ContactSummary;
  readonly active: boolean;
  readonly onSelect: () => void;
}) {
  const dead = contact.npc?.alive === false;
  const primaryBadge = contact.badges[0];
  const subLine =
    (contact.unread > 0 && contact.preview) || contact.highlight || contact.utilityLine;
  return (
    <li>
      <button
        type="button"
        className={styles.contact}
        aria-pressed={active}
        data-dead={dead || undefined}
        onClick={onSelect}
      >
        <Avatar npc={contact.npc?.id} name={contact.name} dead={dead} />
        <span className={styles.contactName}>
          <span className={styles.contactTop}>
            <span className={styles.contactLead}>
              <b className={styles.contactTitle}>{contact.name}</b>
              {contact.isPresent && (
                <span className={styles.contactHereDot} title="就在现场" aria-hidden="true" />
              )}
            </span>
            {primaryBadge ? (
              <span
                className={styles.contactBadge}
                data-tone={primaryBadge.tone}
                title={primaryBadge.detail ?? primaryBadge.label}
              >
                {primaryBadge.shortLabel ?? primaryBadge.label}
              </span>
            ) : contact.isPresent ? (
              <span className={styles.contactHere}>在场</span>
            ) : null}
          </span>
          <small className={styles.contactSub} data-unread={contact.unread > 0 || undefined}>
            {subLine}
          </small>
        </span>
        {contact.unread > 0 && <UnreadBadge>{contact.unread}</UnreadBadge>}
      </button>
    </li>
  );
}

/**
 * 极简顶栏：单行收纳头像（悬浮/点击看全卡）、姓名与关键职能、精简状态与直达按钮，释放垂直空间给聊天流
 */
function ThreadHead({
  contact,
  view,
  thread,
  actions,
}: {
  readonly contact: ContactSummary;
  readonly view: View;
  readonly thread: readonly PhoneMessage[];
  readonly actions: PhoneActions;
}) {
  const { npc } = contact;
  const [open, setOpen] = useState(false);
  // 浮层开着时 Esc 先收浮层，没开时交给神经界面关闭
  useLayer(() => setOpen(false), open);

  const metaParts: string[] = [];
  if (!npc) {
    metaParts.push("匿名加密频道");
  } else if (!npc.alive) {
    if (npc.met && npc.role) metaParts.push(npc.role);
    metaParts.push("终端已离线");
  } else if (!npc.met) {
    metaParts.push(npc.nemesis ? "交过手 · 底细不明" : "只听说过 · 尚未照面");
  } else {
    if (npc.role) metaParts.push(npc.role);
    const place = npc.here ? "就在现场" : (npc.lastPlace ?? npc.homePlace);
    if (place) metaParts.push(place);
  }
  const metaText = metaParts.join(" · ");

  const alive = npc?.alive !== false;
  const docService = alive ? npc?.services?.ripperdoc : undefined;
  const canOpenDoc = Boolean(
    docService && view.ripperdoc?.id === docService.id && actions.onOpenRipperdoc,
  );
  const openShops =
    alive && actions.onOpenShop
      ? (npc?.services?.shops ?? []).filter((s) => view.shops.some((vs) => vs.id === s.id))
      : [];

  const lockReason = inlineChatLockReason(contact, view, actions);
  const latestMsg = thread[thread.length - 1];
  const unreadTarget = contact.unread > 0 ? (latestUnreadMessage(thread) ?? latestMsg) : undefined;
  const canFallback = lockReason !== null && !view.combat?.active && !actions.chatSending;
  const commAction = !canFallback
    ? null
    : alive && unreadTarget && actions.onReply
      ? { label: "回复未读", onClick: () => actions.onReply?.(unreadTarget.id) }
      : alive && npc?.met && actions.onMessageNpc
        ? {
            label: "转行动框",
            onClick: () => actions.onMessageNpc?.(contact.key, contact.name),
          }
        : alive && latestMsg && actions.onReply
          ? { label: "回复", onClick: () => actions.onReply?.(latestMsg.id) }
          : null;

  const locateId = contact.locatePlaceId;
  const locateName = contact.locatePlaceName;
  const hasLocate = Boolean(locateId && locateName && actions.onLocatePlace);
  const hasActions = Boolean(commAction || hasLocate || canOpenDoc || openShops.length > 0);
  const highlightTone = contact.badges[0]?.tone === "danger" ? "danger" : undefined;
  const primaryBadge = contact.badges[0];

  return (
    <header className={styles.threadHead}>
      <div className={styles.threadHeadRow}>
        {npc ? (
          // biome-ignore lint/a11y/noStaticElementInteractions: 外层只管悬停和焦点进出，鼠标从头像移到浮层不断开；能点、能聚焦的是里面的头像按钮
          <span
            className={styles.threadPeek}
            onPointerEnter={(e) => {
              // 触屏没有悬停，靠点按钮开关
              if (e.pointerType !== "touch") setOpen(true);
            }}
            onPointerLeave={(e) => {
              if (e.pointerType !== "touch") setOpen(false);
            }}
            onFocus={() => setOpen(true)}
            onBlur={(e) => {
              const next = e.relatedTarget;
              if (!(next instanceof Node && e.currentTarget.contains(next))) setOpen(false);
            }}
          >
            <button
              type="button"
              className={styles.threadAvatar}
              aria-expanded={open}
              aria-label={`${contact.name}的档案`}
              onClick={() => setOpen((o) => !o)}
            >
              <Avatar npc={npc.id} name={contact.name} dead={!npc.alive} />
            </button>
            {open && (
              <div className={styles.threadCard} data-overlay="">
                <NineSlice
                  id="map.shadowSmall"
                  tint="rgb(0 0 0 / 70%)"
                  slice={TIP_SHADOW_SLICE}
                  className={styles.threadCardShadow}
                />
                <NineSlice
                  id="map.tooltipBg"
                  tint="rgb(14 14 23 / 94%)"
                  slice={TIP_SLICE}
                  className={styles.threadCardLayer}
                />
                <NineSlice
                  id="map.tooltipFg"
                  tint="rgb(94 246 255 / 30%)"
                  slice={TIP_SLICE}
                  className={styles.threadCardLayer}
                />
                <div className={styles.threadCardBody}>
                  <ProfileHead
                    npc={npc}
                    fixer={contact.fixer}
                    squad={contact.squad}
                    foe={contact.foe}
                  />
                </div>
              </div>
            )}
          </span>
        ) : (
          <Avatar name={contact.name} dead={false} />
        )}
        <span className={styles.threadIdentity}>
          <span className={styles.threadTitleRow}>
            <b className={styles.threadTitle}>{contact.name}</b>
            {contact.isPresent && (
              <span className={styles.contactHereDot} title="就在现场" aria-hidden="true" />
            )}
            {npc && !npc.alive ? (
              <span className={styles.threadBadge} data-tone="danger">
                已故
              </span>
            ) : primaryBadge ? (
              <span
                className={styles.threadBadge}
                data-tone={primaryBadge.tone}
                title={primaryBadge.detail ?? primaryBadge.label}
              >
                {primaryBadge.shortLabel ?? primaryBadge.label}
              </span>
            ) : null}
            {npc?.met && npc.alive && (
              <span className={styles.threadAffinity}>{affinityLabel(npc.affinity)}</span>
            )}
          </span>
          {metaText && (
            <small className={styles.threadMeta} title={metaText}>
              {metaText}
            </small>
          )}
        </span>
        {hasActions && (
          <div className={styles.threadActions}>
            {commAction && (
              <ActionButton onClick={commAction.onClick}>{commAction.label}</ActionButton>
            )}
            {locateId && locateName && actions.onLocatePlace && (
              <ActionButton
                title={`在地图上定位到${locateName}`}
                onClick={() => actions.onLocatePlace?.(locateId)}
              >
                定位
              </ActionButton>
            )}
            {canOpenDoc && actions.onOpenRipperdoc && (
              <ActionButton onClick={actions.onOpenRipperdoc}>进诊所</ActionButton>
            )}
            {openShops.map((shop) => (
              <ActionButton key={shop.id} onClick={() => actions.onOpenShop?.(shop.id)}>
                {shop.name}
              </ActionButton>
            ))}
          </div>
        )}
      </div>
      {contact.highlight && (
        <p className={styles.threadHighlight} data-tone={highlightTone}>
          {contact.highlight}
        </p>
      )}
      <span
        className={styles.threadRule}
        style={{ maskImage: cssUrl("tab.line"), WebkitMaskImage: cssUrl("tab.line") }}
        aria-hidden
      />
    </header>
  );
}

/** 消息页的私信栏：左边按职能/在场筛选联系人并一眼看出用途，右边查看往来短讯或直接发起联系 */
export function PhoneBody({
  view,
  onReply,
  onMessageNpc,
  onSendChat,
  onReadThread,
  chatSending,
  pendingChat,
  busy,
  onLocatePlace,
  onOpenRipperdoc,
  onOpenShop,
}: { readonly view: View } & PhoneActions) {
  const contacts = contactDirectory(view);
  const { counts, tabs } = computeFilterTabs(contacts);
  const [filter, setFilter] = useState<ContactFilter>("all");
  const activeFilter: ContactFilter = filter !== "all" && counts[filter] > 0 ? filter : "all";
  const filterRule = FILTER_OPTIONS.find((opt) => opt.id === activeFilter) ?? FILTER_OPTIONS[0];
  const filtered =
    activeFilter === "all" || !filterRule ? contacts : contacts.filter(filterRule.match);

  const [picked, setPicked] = useState<string | null>(
    () => (contacts.find((c) => c.unread > 0) ?? contacts[0])?.key ?? null,
  );
  const current = filtered.find((c) => c.key === picked) ?? filtered[0] ?? contacts[0];
  // 消息往来旧的在前，像聊天窗口
  const thread = current ? view.phone.messages.filter((m) => m.from === current.key).reverse() : [];
  const pendingForCurrent =
    current && pendingChat?.contact === current.key ? pendingChat.text : null;
  const bubbles = buildChatBubbles(thread, pendingForCurrent);

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [chatErrors, setChatErrors] = useState<Record<string, string>>({});
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const clearErrorFor = (key: string) => {
    setChatErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  // 只把当前打开这个联系人名下的未读消息标已读；不改动其他联系人的未读角标
  const currentKey = current?.key ?? "";
  const unreadKey = thread
    .filter((m) => m.sender !== "player" && !m.read)
    .map((m) => m.id)
    .join(",");
  const onReadRef = useRef(onReadThread);
  onReadRef.current = onReadThread;
  useEffect(() => {
    if (!currentKey || unreadKey === "") return;
    const ids = unreadKey.split(",").map(Number).filter(Number.isFinite);
    if (ids.length > 0) onReadRef.current?.(ids);
  }, [currentKey, unreadKey]);

  // 切换联系人或收到/发出新消息/显示输入中状态时自动滚到最底端
  const scrollSig = `${currentKey}:${bubbles.length}:${pendingForCurrent !== null ? 1 : 0}`;
  useEffect(() => {
    const el = listRef.current;
    if (!el || !scrollSig) return;
    el.scrollTop = el.scrollHeight;
  }, [scrollSig]);

  if (contacts.length === 0 || !current) {
    return (
      <div className={styles.phoneEmpty}>
        <div className={styles.phoneEmptyCard}>
          <CellFrame />
          <Asset id="notify.attention" tint="var(--cp-cyan-dim)" height={24} />
          <b className={styles.phoneEmptyTitle}>还没有联系人</b>
          <p className={styles.phoneEmptyText}>
            在夜之城结识新人物或收到加密简讯后，频道会在此出现。
          </p>
        </div>
      </div>
    );
  }

  const actions: PhoneActions = {
    onReply,
    onMessageNpc,
    onSendChat,
    onReadThread,
    chatSending,
    pendingChat,
    busy,
    onLocatePlace,
    onOpenRipperdoc,
    onOpenShop,
  };
  const lockReason = inlineChatLockReason(current, view, actions);
  const sendingAny = Boolean(chatSending || pendingChat);
  const sendingThis = Boolean(pendingForCurrent !== null || chatSending === current.key);
  const fallbackReply =
    current.npc?.alive !== false && lockReason !== null && !view.combat?.active && !sendingAny
      ? onReply
      : undefined;
  const draftText = drafts[current.key] ?? "";
  const currentError = chatErrors[current.key] ?? null;
  const urgentWarning = urgentChatDeadline(view);

  const submitChat = async () => {
    if (lockReason !== null || sendingAny || !onSendChat) return;
    const text = draftText.trim();
    if (text === "") return;
    const targetKey = current.key;
    clearErrorFor(targetKey);
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[targetKey];
      return next;
    });
    const res = await onSendChat(targetKey, text);
    if (!res.ok) {
      setDrafts((prev) => (prev[targetKey] ? prev : { ...prev, [targetKey]: text }));
      setChatErrors((prev) => ({ ...prev, [targetKey]: res.error }));
    }
    inputRef.current?.focus();
  };

  return (
    <div className={styles.phoneLayout}>
      <aside className={styles.phoneLeft} aria-label="联系人筛选与目录">
        {tabs.length > 1 && contacts.length > 3 && (
          <fieldset className={styles.phoneFilters}>
            <legend className={styles.phoneFilterLegend}>筛选联系人</legend>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={styles.phoneFilter}
                aria-pressed={activeFilter === tab.id}
                onClick={() => setFilter(tab.id)}
              >
                <span>{tab.label}</span>
                <span className={styles.phoneFilterCount}>{tab.count}</span>
              </button>
            ))}
          </fieldset>
        )}
        <ul className={styles.contactList} aria-label="联系人">
          {filtered.map((c) => (
            <ContactRow
              key={c.key}
              contact={c}
              active={c.key === current.key}
              onSelect={() => setPicked(c.key)}
            />
          ))}
        </ul>
      </aside>
      <section className={styles.threadPane} aria-label={`和${current.name}的消息`}>
        <ThreadHead
          key={current.key}
          contact={current}
          view={view}
          thread={thread}
          actions={actions}
        />
        {bubbles.length === 0 && !sendingThis ? (
          <div className={styles.phoneEmpty}>
            <div className={styles.phoneEmptyCard}>
              <CellFrame />
              <Asset id="notify.attention" tint="var(--cp-cyan-dim)" height={24} />
              <b className={styles.phoneEmptyTitle}>暂无通讯记录</b>
              <p className={styles.phoneEmptyText}>
                {current.npc
                  ? current.npc.alive === false
                    ? `${current.name} 的终端已离线。`
                    : current.npc.met
                      ? `与 ${current.name} 还没有短讯往来，在下方直接发一句就能接上线。`
                      : "尚未建立直接加密连线。"
                  : "该频道暂无历史消息。"}
              </p>
            </div>
          </div>
        ) : (
          <ul ref={listRef} className={styles.phoneList}>
            {bubbles.map((b) => {
              const showHead = !b.grouped || b.unread || b.pending;
              return (
                <li
                  key={b.key}
                  className={styles.phoneItem}
                  data-sender={b.sender}
                  data-grouped={b.grouped || undefined}
                >
                  <div
                    className={b.sender === "player" ? styles.phoneReply : styles.phoneBubble}
                    data-unread={b.unread || undefined}
                    data-pending={b.pending || undefined}
                  >
                    {showHead && (
                      <p className={styles.phoneHead}>
                        {!b.grouped && (
                          <span
                            className={
                              b.sender === "player" ? styles.phoneReplySender : styles.phoneSender
                            }
                          >
                            {b.sender === "player" ? "你" : current.name}
                          </span>
                        )}
                        {b.unread && <UnreadBadge>新</UnreadBadge>}
                        {b.at && <time className={styles.phoneTime}>{b.at}</time>}
                      </p>
                    )}
                    <p className={styles.phoneText}>
                      {b.text}
                      {!showHead && b.at && <time className={styles.phoneTimeInline}>{b.at}</time>}
                    </p>
                    {b.job && (
                      <div
                        className={styles.phoneJobTag}
                        data-status={
                          b.job.status === "offered"
                            ? "offered"
                            : b.job.status === "active"
                              ? "active"
                              : "closed"
                        }
                      >
                        <span className={styles.phoneJobTitle}>
                          {b.job.status === "offered"
                            ? `来活提议 · ${b.job.title}`
                            : b.job.status === "active"
                              ? `已接手 · ${b.job.title}`
                              : `${b.job.statusLabel} · ${b.job.title}`}
                        </span>
                        <span className={styles.phoneJobMeta}>
                          {b.job.reward > 0
                            ? `报酬 ${b.job.reward.toLocaleString("en-US")} 欧元`
                            : null}
                          {b.job.due ? `${b.job.reward > 0 ? " · " : ""}${b.job.due} 前` : null}
                          {b.job.status === "offered"
                            ? `${b.job.reward > 0 || b.job.due ? " · " : ""}${
                                lockReason === null
                                  ? "直接在下方私信答应即可接单"
                                  : view.combat?.active
                                    ? "脱战后私信即可答应接单"
                                    : "点「回复」在行动框里答应即可接进追踪"
                              }`
                            : null}
                        </span>
                      </div>
                    )}
                    {((b.fallbackId !== null && fallbackReply) || b.ack) && (
                      <div className={styles.phoneItemFoot}>
                        {b.ack && <span className={styles.phoneAck}>已回复</span>}
                        {b.fallbackId !== null && fallbackReply && (
                          <ActionButton onClick={() => fallbackReply(b.fallbackId as number)}>
                            回复
                          </ActionButton>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
            {sendingThis && (
              <li className={styles.phoneItem} data-sender="npc">
                <div className={`${styles.phoneBubble} ${styles.phoneTyping}`} aria-live="polite">
                  <span className={styles.phoneSender}>{current.name}</span>
                  <span
                    className={styles.phoneTypingDots}
                    role="img"
                    aria-label={`${current.name} 正在输入`}
                  >
                    <i />
                    <i />
                    <i />
                  </span>
                </div>
              </li>
            )}
          </ul>
        )}
        <footer className={styles.phoneComposerWrap}>
          {urgentWarning && lockReason === null && (
            <p className={styles.phoneDueWarn}>
              <Asset id="notify.attention" tint="var(--cp-yellow)" height={13} />
              <span>
                紧急约定「{urgentWarning.title}」仅剩 {urgentWarning.left} 分钟（每轮短讯耗时 1–3
                分钟）
              </span>
            </p>
          )}
          {currentError && (
            <p className={styles.phoneComposerError} role="alert">
              <Asset id="notify.warning" tint="var(--cp-red)" height={13} />
              <span>{currentError}</span>
            </p>
          )}
          {lockReason !== null ? (
            <p className={styles.phoneComposerLock}>{lockReason}</p>
          ) : (
            <form
              className={styles.phoneComposer}
              onSubmit={(e) => {
                e.preventDefault();
                void submitChat();
              }}
            >
              <div className={styles.phoneComposerRow}>
                <textarea
                  ref={inputRef}
                  className={styles.phoneInput}
                  rows={1}
                  maxLength={300}
                  placeholder={
                    sendingThis
                      ? `${current.name} 正在回信…可先输入下一句`
                      : `给 ${current.name} 发短讯…（Enter 发送，每轮 1–3 分钟）`
                  }
                  value={draftText}
                  aria-label={`给${current.name}发短讯`}
                  onChange={(e) => {
                    const value = e.target.value;
                    clearErrorFor(current.key);
                    setDrafts((prev) => ({ ...prev, [current.key]: value }));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      void submitChat();
                    }
                  }}
                />
                <ActionButton
                  submit
                  disabled={sendingAny || draftText.trim() === ""}
                  title="Enter 发送（每轮消耗 1–3 分钟，不在手机内做检定或完单结算）"
                >
                  {sendingThis ? "回信中" : "发送"}
                </ActionButton>
              </div>
            </form>
          )}
        </footer>
      </section>
    </div>
  );
}
