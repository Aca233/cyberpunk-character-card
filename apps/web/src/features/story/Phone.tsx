import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActionButton } from "../../ui/ActionButton";
import { Asset, cssUrl, NineSlice } from "../../ui/Asset";
import { CellFrame } from "../../ui/FrameBox";
import { useLayer } from "../../ui/layers";
import { GeneratedImage } from "../images/GeneratedImage";
import { useSaveImages } from "../images/SaveImagesContext";
import { portraitOf } from "./art";
import { npcRelationTag, ProfileHead } from "./Profile";
import styles from "./phone.module.css";
import {
  buildChatBubbles,
  type ContactFilter,
  type ContactSummary,
  contactDirectory,
  urgentChatDeadline,
  type View,
} from "./view";

type PhoneMessage = View["phone"]["messages"][number];
type CallHistoryItem = NonNullable<View["calls"]>["history"][number];

const CELL_SLICE = [20, 30, 30, 20] as const;
const MAX_MESSAGE_LEN = 300;
const SEARCH_THRESHOLD = 4;

const FILTER_OPTIONS: readonly {
  readonly id: ContactFilter;
  readonly label: string;
  readonly match: (c: ContactSummary) => boolean;
}[] = [
  { id: "all", label: "全部", match: () => true },
  { id: "unread", label: "未读", match: (c) => c.unread > 0 },
  { id: "active", label: "有事", match: (c) => c.isActive },
  { id: "utility", label: "渠道", match: (c) => c.isUtility },
  { id: "present", label: "在场", match: (c) => c.isPresent },
];

/** 头像：有原作头像（avatars 图集）或自定义生图的人物用肖像图，没有的用名字首字；框用原作 map.filterCell* */
export function Avatar({
  name,
  dead,
  npc,
  size,
  present,
  scan,
}: {
  readonly name: string;
  readonly dead: boolean;
  /** 人物 id；不传或没有原作头像时退回名字的第一个字 */
  readonly npc?: string | undefined;
  readonly size?: "sm" | "lg" | undefined;
  readonly present?: boolean | undefined;
  readonly scan?: boolean | undefined;
}) {
  const saveImages = useSaveImages();
  const customId = npc ? (saveImages?.bindings.npcs[npc] ?? null) : null;
  const portrait = portraitOf(npc);
  return (
    <span className={styles.avatarWrap} aria-hidden="true">
      <span className={styles.avatar} data-dead={dead || undefined} data-size={size}>
        <NineSlice
          id="map.filterCellBg"
          tint="var(--box-fill, var(--cp-surface))"
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
        {scan && (
          <span className={styles.avatarScan} style={{ backgroundImage: cssUrl("fx.scanlines") }} />
        )}
        <NineSlice
          id="map.filterCellFg"
          tint="var(--box-line, var(--cp-cyan-dim))"
          slice={CELL_SLICE}
        />
      </span>
      {present && !dead && <i className={styles.presentBeacon} title="就在现场" />}
    </span>
  );
}

/** 未读角标（计划第十二节第 9 条）：联系人和芯片共用原作数字格，四边保留 16 原图像素，字数增加时只拉伸中间 */
export function UnreadBadge({ children }: { readonly children: string | number }) {
  return (
    <span className={styles.unreadBadge}>
      <NineSlice id="dialog.numberSlot" tint="var(--cp-yellow)" slice={16} />
      {children}
    </span>
  );
}

/** 浮层照原作世界地图默认 tooltip 的三层（阴影、底、框），切线同 MapPanel 的 TOOLTIP_SLICE / SHADOW_SLICE */
const TIP_SLICE = [10, 30, 70, 10] as const;
const TIP_SHADOW_SLICE = 20;

/** 正在等待服务器返回的一条本地乐观聊天 */
export interface PendingPhoneChat {
  readonly contact: string;
  readonly text: string;
}

/** 手机直聊单次发送结果：失败时把具体错误回传到输入框旁就地展示 */
export type PhoneSendResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };

/** 联系人公共操作回调：手机窗口内直聊、标已读、回复进主线、地图定位、直开诊所 */
export interface PhoneActions {
  /** 回复一条（填入下方行动输入框）；正在生成或已结束时不传，按钮不显示 */
  readonly onReply?: ((id: number) => void) | undefined;
  /** 主动给人物发一条填入下方行动输入框的私信 */
  readonly onMessageNpc?: ((id: string, name: string) => void) | undefined;
  /** 在手机窗口内直接发送私信（调辅助模型并推进 1–3 分钟）；返回发送结果 */
  readonly onSendChat?: ((contact: string, text: string) => Promise<PhoneSendResult>) | undefined;
  /** 切到某个联系人且其有未读短信时，只把该联系人名下的未读消息标已读 */
  readonly onReadThread?: ((unreadIds: readonly number[]) => void) | undefined;
  /** 查看一条未接来电时，只把这条来电提醒标已读 */
  readonly onReadCall?: ((id: number) => void) | undefined;
  /** 接听或拒接正在响铃的全息来电 */
  readonly onAnswerCall?: ((id: number, answer: boolean) => void) | undefined;
  /** 直接接下消息卡片上附带的待接委托 */
  readonly onAcceptJob?: ((id: string) => void) | undefined;
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
  /** 从空通讯录跳到「人物」页查看已知人物 */
  readonly onOpenPeople?: (() => void) | undefined;
  /** 外部指定自动定位到的联系人 key（例如从「人物」页点击发消息） */
  readonly focusContact?: string | null | undefined;
  /** 消费完 focusContact 后的回调 */
  readonly onConsumeFocus?: (() => void) | undefined;
}

function latestUnreadMessage(thread: readonly PhoneMessage[]): PhoneMessage | undefined {
  for (let i = thread.length - 1; i >= 0; i -= 1) {
    const msg = thread[i];
    if (msg && msg.sender !== "player" && !msg.read) return msg;
  }
  return undefined;
}

/** 根据联系人身份推荐快捷破冰短语，点击后填入输入框并聚焦，不自动替玩家发送 */
function starterPromptsOf(contact: ContactSummary): readonly string[] {
  const { npc } = contact;
  if (!contact.alive || !contact.canChat) return [];
  if (!npc?.met) {
    if (contact.isFixer) {
      return contact.fixer?.blocked
        ? ["关于之前那档子事，咱们还有得谈吗？", "最近街上风声怎么样？"]
        : ["手头最近有合适的新活派吗？", "关于你发来的单子，具体细节怎么说？"];
    }
    return ["刚存了你的频道，确认下能收到吗？", "方便聊聊之前提到的事吗？"];
  }
  const doc = npc.services?.ripperdoc;
  const shops = npc.services?.shops ?? [];
  const isFixer = Boolean(contact.fixer || contact.isFixer || npc.role.includes("中间人"));
  if (doc) {
    return doc.debt
      ? ["手头凑了点钱，诊所现在方便过来还账吗？", "最近诊所有什么新义体到货？"]
      : ["诊所现在方便吗？想聊聊义体改装的事。", "最近有没有搞到什么好货？"];
  }
  if (isFixer) {
    return contact.fixer?.blocked
      ? ["关于之前那档子事，咱们还有得谈吗？", "最近街上风声怎么样？"]
      : ["手头最近有合适的新活派吗？", "最近这片街区有什么风声？"];
  }
  if (shops.length > 0) {
    return ["店里最近有没有新到的货？", "最近这片街区还太平吗？"];
  }
  if (npc.following) {
    return ["准备得怎么样？下一步咱们怎么走？", "留意下周围动静，有情况随时喊我。"];
  }
  return ["最近怎么样？还在忙什么？", "打听个事，最近街上有什么新鲜风声吗？"];
}

function IncomingCallBanner({
  incoming,
  busy,
  onAnswerCall,
}: {
  readonly incoming: NonNullable<View["calls"]>["incoming"];
  readonly busy?: boolean | undefined;
  readonly onAnswerCall?: ((id: number, answer: boolean) => void) | undefined;
}) {
  if (!incoming) return null;
  const disabled = Boolean(busy || !onAnswerCall);
  return (
    <section className={styles.incomingCall} aria-label="正在响铃的全息来电">
      <div className={styles.incomingLead}>
        <Avatar npc={incoming.from} name={incoming.name} dead={false} size="sm" scan />
        <span className={styles.incomingMeta}>
          <span className={styles.incomingKicker}>
            <span>{"HOLOCALL // 响铃中"}</span>
            <span className={styles.callWave} aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </span>
          </span>
          <b className={styles.incomingName}>{incoming.name}</b>
          <time className={styles.incomingTime}>{incoming.at}</time>
        </span>
      </div>
      <span className={styles.incomingActions}>
        <button
          type="button"
          className={`${styles.callBtn} ${styles.callAccept}`}
          disabled={disabled}
          onClick={() => onAnswerCall?.(incoming.id, true)}
        >
          接通
        </button>
        <button
          type="button"
          className={`${styles.callBtn} ${styles.callDecline}`}
          disabled={disabled}
          onClick={() => onAnswerCall?.(incoming.id, false)}
        >
          挂断
        </button>
      </span>
    </section>
  );
}

function MissedCalls({
  calls,
  contactKeys,
  onReadCall,
  onSelectContact,
}: {
  readonly calls: readonly CallHistoryItem[];
  readonly contactKeys: ReadonlySet<string>;
  readonly onReadCall?: ((id: number) => void) | undefined;
  readonly onSelectContact?: ((key: string) => void) | undefined;
}) {
  if (calls.length === 0) return null;
  return (
    <section className={styles.missedCalls} aria-label="未接全息电话">
      <div className={styles.missedCallsHead}>
        <h3 className={styles.missedCallsTitle}>
          <Asset id="notify.warning" tint="var(--cp-red)" height={12} />
          <span>未接全息电话 · {calls.length}</span>
        </h3>
      </div>
      <ul className={styles.missedCallList}>
        {calls.map((call) => {
          const canJump = Boolean(onSelectContact && contactKeys.has(call.from));
          return (
            <li key={call.id} className={styles.missedCallRow}>
              <span className={styles.missedCallInfo}>
                <b className={styles.missedCallName}>{call.name}</b>
                <time className={styles.missedCallTime}>{call.at}</time>
              </span>
              <span className={styles.missedCallActions}>
                {canJump && (
                  <ActionButton
                    onClick={() => {
                      onSelectContact?.(call.from);
                      onReadCall?.(call.id);
                    }}
                  >
                    去回信
                  </ActionButton>
                )}
                <ActionButton onClick={() => onReadCall?.(call.id)}>标已读</ActionButton>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

interface LockInfo {
  readonly reason: string;
  readonly tone: "danger" | "busy" | "neutral";
}

/** 结构性禁用直聊的原因（不包含短暂等待发送，避免发送期间卸载输入框丢焦点） */
function inlineChatLockInfo(
  contact: ContactSummary,
  view: View,
  actions: Pick<PhoneActions, "onSendChat" | "busy">,
): LockInfo | null {
  if (view.death || view.ended) {
    return { reason: "故事已结束，通讯频道仅可回看", tone: "neutral" };
  }
  if (view.combat?.active) {
    return { reason: "正在交火，先脱身或解决眼前这架再发消息", tone: "danger" };
  }
  if (!contact.alive) {
    return { reason: `${contact.name} 的终端已离线`, tone: "danger" };
  }
  if (!contact.canChat) {
    return {
      reason: "匿名加密频道暂不支持私聊，可点上方「回复」在行动框里处理",
      tone: "neutral",
    };
  }
  if (actions.busy) {
    return { reason: "主线回合正在生成，请稍候片刻", tone: "busy" };
  }
  if (!actions.onSendChat) {
    return { reason: "当前暂不可发送私信", tone: "neutral" };
  }
  return null;
}

function computeFilterTabs(contacts: readonly ContactSummary[]) {
  const counts: Record<ContactFilter, number> = {
    all: contacts.length,
    unread: 0,
    active: 0,
    utility: 0,
    present: 0,
  };
  for (const c of contacts) {
    if (c.unread > 0) counts.unread += 1;
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

function matchesSearch(c: ContactSummary, q: string): boolean {
  const hay = [
    c.name,
    c.npc?.alias ?? "",
    c.npc?.role ?? "",
    c.npc?.faction ?? "",
    c.npc?.lastPlace ?? "",
    c.npc?.homePlace ?? "",
    c.utilityLine,
    c.highlight ?? "",
    c.preview ?? "",
    ...c.badges.map((b) => b.label),
  ]
    .join("\n")
    .toLocaleLowerCase();
  return hay.includes(q);
}

/** 联系人左栏卡片：姓名 + 末次时间 + 职能短牌 + 草稿/未读摘要 + 右侧未读数 */
function ContactRow({
  contact,
  active,
  draft,
  onSelect,
}: {
  readonly contact: ContactSummary;
  readonly active: boolean;
  readonly draft: string;
  readonly onSelect: () => void;
}) {
  const dead = !contact.alive;
  const primaryBadge = contact.badges[0];
  const hasDraft = draft.trim().length > 0 && !active;
  const subLine = hasDraft
    ? draft.trim()
    : (contact.unread > 0 && contact.preview) || contact.highlight || contact.utilityLine;
  return (
    <li>
      <button
        type="button"
        className={styles.contactBtn}
        aria-pressed={active}
        data-dead={dead || undefined}
        data-unread={contact.unread > 0 && !active ? true : undefined}
        onClick={onSelect}
      >
        <Avatar
          npc={contact.npc?.id ?? contact.key}
          name={contact.name}
          dead={dead}
          present={contact.isPresent}
          scan={active}
        />
        <span className={styles.contactInfo}>
          <span className={styles.contactTop}>
            <b className={styles.contactName}>{contact.name}</b>
            {primaryBadge ? (
              <span
                className={styles.badge}
                data-tone={primaryBadge.tone}
                title={primaryBadge.detail ?? primaryBadge.label}
              >
                {primaryBadge.shortLabel ?? primaryBadge.label}
              </span>
            ) : contact.last ? (
              <time className={styles.contactTime}>{contact.last}</time>
            ) : null}
          </span>
          <span className={styles.contactBottom}>
            {hasDraft && <span className={styles.contactDraftTag}>草稿</span>}
            <small className={styles.contactSub} data-unread={contact.unread > 0 || undefined}>
              {subLine}
            </small>
          </span>
        </span>
        {contact.unread > 0 && <UnreadBadge>{contact.unread}</UnreadBadge>}
      </button>
    </li>
  );
}

/**
 * 终端对话顶栏：扫描线头像（悬停/点击展开档案浮层）、姓名与多职能短牌、色阶好感胶囊、直达操作按钮与关键待办条
 */
function ThreadHead({
  contact,
  view,
  thread,
  actions,
  lockInfo,
}: {
  readonly contact: ContactSummary;
  readonly view: View;
  readonly thread: readonly PhoneMessage[];
  readonly actions: PhoneActions;
  readonly lockInfo: LockInfo | null;
}) {
  const { npc } = contact;
  const [hoverOpen, setHoverOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);
  const hovering = useRef(false);
  const peekRef = useRef<HTMLDivElement>(null);
  const open = hoverOpen || pinned;

  const clearCloseTimer = useCallback(() => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = undefined;
  }, []);
  const closeCard = useCallback(() => {
    clearCloseTimer();
    setPinned(false);
    setHoverOpen(false);
  }, [clearCloseTimer]);
  const scheduleClose = useCallback(() => {
    clearCloseTimer();
    if (pinned) return;
    closeTimer.current = window.setTimeout(() => setHoverOpen(false), 320);
  }, [clearCloseTimer, pinned]);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);
  useEffect(() => {
    if (!pinned) return;
    const onOutsidePointerDown = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && !peekRef.current?.contains(event.target)) closeCard();
    };
    document.addEventListener("pointerdown", onOutsidePointerDown, true);
    return () => document.removeEventListener("pointerdown", onOutsidePointerDown, true);
  }, [closeCard, pinned]);

  // 浮层开着时 Esc 先收浮层，没开时交给抽屉关闭
  useLayer(closeCard, open);

  const toggleDossier = () => {
    clearCloseTimer();
    const next = !pinned;
    setPinned(next);
    setHoverOpen(next || hovering.current);
  };

  const metaParts: string[] = [];
  if (!npc) {
    if (!contact.alive) {
      metaParts.push("终端已离线");
    } else if (contact.isFixer) {
      metaParts.push("中间人 · 加密连线（尚未照面）");
    } else if (contact.canChat) {
      metaParts.push("加密连线 · 尚未照面");
    } else {
      metaParts.push("匿名加密频道");
    }
  } else if (!npc.alive) {
    if (npc.met && npc.role) metaParts.push(npc.role);
    metaParts.push("终端已离线");
  } else if (!npc.met) {
    metaParts.push(
      npc.nemesis
        ? "交过手 · 底细不明"
        : contact.isFixer
          ? "中间人 · 尚未照面"
          : "加密连线 · 尚未照面",
    );
  } else {
    if (npc.role) metaParts.push(npc.role);
    const place = npc.here ? "就在现场" : (npc.lastPlace ?? npc.homePlace);
    if (place) metaParts.push(place);
  }
  const metaText = metaParts.join(" · ");

  const alive = contact.alive;
  const docService = alive ? npc?.services?.ripperdoc : undefined;
  const canOpenDoc = Boolean(
    docService && view.ripperdoc?.id === docService.id && actions.onOpenRipperdoc,
  );

  const latestMsg = thread[thread.length - 1];
  const unreadTarget = contact.unread > 0 ? (latestUnreadMessage(thread) ?? latestMsg) : undefined;
  const canEscalate = !view.combat?.active && !actions.chatSending && !actions.busy;
  const commAction = !canEscalate
    ? null
    : lockInfo !== null && alive && unreadTarget && actions.onReply
      ? {
          label: "回复未读",
          title: "带入下方主线行动栏回复该未读消息",
          onClick: () => actions.onReply?.(unreadTarget.id),
        }
      : alive && contact.canChat && actions.onMessageNpc
        ? {
            label: lockInfo !== null ? "转行动框" : "进主线",
            title: "填入主线行动栏（适合涉及检定、交易或剧情推进的重要对话）",
            onClick: () => actions.onMessageNpc?.(contact.key, contact.name),
          }
        : lockInfo !== null && alive && latestMsg && actions.onReply
          ? {
              label: "回复",
              title: "带入下方主线行动栏回复",
              onClick: () => actions.onReply?.(latestMsg.id),
            }
          : null;

  const locateId = contact.locatePlaceId;
  const locateName = contact.locatePlaceName;
  const hasLocate = Boolean(locateId && locateName && actions.onLocatePlace);
  const hasActions = Boolean(commAction || hasLocate || canOpenDoc);
  const highlightTone = contact.badges[0]?.tone === "danger" ? "danger" : undefined;
  const visibleBadges = !alive ? [] : contact.badges.slice(0, 2);

  return (
    <header className={styles.threadHead}>
      <div ref={peekRef} className={styles.threadHeadBar} data-dead={!alive || undefined}>
        {npc ? (
          // biome-ignore lint/a11y/noStaticElementInteractions: 外层仅处理悬停焦点进出，确保鼠标移入档案浮层不断开
          <span
            className={styles.threadPeek}
            onPointerEnter={(e) => {
              if (e.pointerType !== "touch") {
                hovering.current = true;
                clearCloseTimer();
                setHoverOpen(true);
              }
            }}
            onPointerLeave={(e) => {
              if (e.pointerType !== "touch") {
                hovering.current = false;
                scheduleClose();
              }
            }}
            onFocus={() => {
              clearCloseTimer();
              setHoverOpen(true);
            }}
            onBlur={(e) => {
              const next = e.relatedTarget;
              if (!(next instanceof Node && e.currentTarget.contains(next))) scheduleClose();
            }}
          >
            <button
              type="button"
              className={styles.threadAvatarBtn}
              aria-expanded={open}
              aria-pressed={pinned}
              aria-label={`查看 ${contact.name} 的档案`}
              onClick={toggleDossier}
            >
              <Avatar
                npc={npc.id}
                name={contact.name}
                dead={!npc.alive}
                present={contact.isPresent}
                scan
              />
              <span className={styles.avatarDossierCue}>档案</span>
            </button>
          </span>
        ) : (
          <Avatar npc={contact.key} name={contact.name} dead={!alive} scan />
        )}

        <span className={styles.threadIdentity}>
          <span className={styles.threadTitleRow}>
            <b className={styles.threadTitle}>{contact.name}</b>
            {!alive && (
              <span className={styles.badge} data-tone="danger">
                已故
              </span>
            )}
            {visibleBadges.map((badge) => (
              <span
                key={badge.label}
                className={styles.badge}
                data-tone={badge.tone}
                title={badge.detail ?? badge.label}
              >
                {badge.shortLabel ?? badge.label}
              </span>
            ))}
            {npc?.met &&
              npc.alive &&
              (() => {
                const relTag = npcRelationTag(npc);
                return relTag ? (
                  <span
                    className={styles.affinityPill}
                    data-tone={relTag.tone}
                    title={relTag.title}
                  >
                    {relTag.label}
                  </span>
                ) : null;
              })()}
          </span>
          <span className={styles.threadMetaRow}>
            {metaText && (
              <small className={styles.threadMeta} title={metaText}>
                {metaText}
              </small>
            )}
            {npc && (
              <button
                type="button"
                className={styles.dossierTrigger}
                aria-expanded={open}
                onClick={toggleDossier}
              >
                {pinned ? "收起档案" : "查看档案"}
              </button>
            )}
          </span>
        </span>

        {hasActions && (
          <div className={styles.threadActions}>
            {canOpenDoc && actions.onOpenRipperdoc && (
              <ActionButton title="直接打开义体诊所界面" onClick={actions.onOpenRipperdoc}>
                <span className={styles.headActionContent}>
                  <Asset id="map.poi.ripperdoc" tint="currentColor" height={12} />
                  <span>进诊所</span>
                </span>
              </ActionButton>
            )}
            {locateId && locateName && actions.onLocatePlace && (
              <ActionButton
                title={`在地图上定位到${locateName}`}
                onClick={() => actions.onLocatePlace?.(locateId)}
              >
                <span className={styles.headActionContent}>
                  <Asset id="map.pinDest" tint="currentColor" height={12} />
                  <span>定位</span>
                </span>
              </ActionButton>
            )}
            {commAction && (
              <ActionButton title={commAction.title} onClick={commAction.onClick}>
                <span className={styles.headActionContent}>
                  <Asset id="interaction.talk" tint="currentColor" height={12} />
                  <span>{commAction.label}</span>
                </span>
              </ActionButton>
            )}
          </div>
        )}

        {npc && open && (
          <div
            className={styles.threadCard}
            data-overlay=""
            onPointerEnter={() => {
              hovering.current = true;
              clearCloseTimer();
            }}
            onPointerLeave={() => {
              hovering.current = false;
              scheduleClose();
            }}
          >
            <NineSlice
              id="map.shadowSmall"
              tint="rgb(0 0 0 / 74%)"
              slice={TIP_SHADOW_SLICE}
              className={styles.threadCardShadow}
            />
            <NineSlice
              id="map.tooltipBg"
              tint="var(--cp-surface-strong)"
              slice={TIP_SLICE}
              className={styles.threadCardLayer}
            />
            <NineSlice
              id="map.tooltipFg"
              tint="rgb(94 246 255 / 34%)"
              slice={TIP_SLICE}
              className={styles.threadCardLayer}
            />
            <div className={styles.threadCardBody}>
              <ProfileHead npc={npc} fixer={contact.fixer} foe={contact.foe} />
            </div>
          </div>
        )}
      </div>

      {contact.highlight && (
        <p className={styles.threadHighlight} data-tone={highlightTone}>
          <Asset
            id={highlightTone === "danger" ? "notify.warning" : "notify.questUpdate"}
            tint={highlightTone === "danger" ? "var(--cp-red)" : "var(--cp-yellow)"}
            height={13}
          />
          <span>{contact.highlight}</span>
        </p>
      )}
    </header>
  );
}

/** 消息页的私信栏：左栏支持搜索与未读/职能/在场筛选，右栏展示全息对话、委托快捷回填与加密私聊输入 */
export function PhoneBody({
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
}: { readonly view: View } & PhoneActions) {
  const contacts = contactDirectory(view);
  const { counts, tabs } = computeFilterTabs(contacts);
  const [filter, setFilter] = useState<ContactFilter>("all");
  const [query, setQuery] = useState("");
  const activeFilter: ContactFilter = filter !== "all" && counts[filter] > 0 ? filter : "all";
  const filterRule = FILTER_OPTIONS.find((opt) => opt.id === activeFilter) ?? FILTER_OPTIONS[0];

  const showSearch = contacts.length > SEARCH_THRESHOLD;
  const keyword = showSearch ? query.trim().toLocaleLowerCase() : "";

  const [picked, setPicked] = useState<string | null>(
    () =>
      (focusContact && contacts.some((c) => c.key === focusContact)
        ? focusContact
        : (contacts.find((c) => c.unread > 0) ?? contacts[0])?.key) ?? null,
  );
  const onConsumeFocusRef = useRef(onConsumeFocus);
  onConsumeFocusRef.current = onConsumeFocus;
  useEffect(() => {
    if (!focusContact) return;
    setFilter("all");
    setQuery("");
    setPicked(focusContact);
    onConsumeFocusRef.current?.();
  }, [focusContact]);
  // 在「未读」筛选下打开某条未读会话后会立刻标已读；保留当前选中会话在列表里，避免读到一半界面跳走
  const filtered = useMemo(() => {
    const byTab =
      activeFilter === "all" || !filterRule
        ? contacts
        : contacts.filter(
            (c) => filterRule.match(c) || (activeFilter === "unread" && c.key === picked),
          );
    return keyword ? byTab.filter((c) => matchesSearch(c, keyword)) : byTab;
  }, [activeFilter, contacts, filterRule, keyword, picked]);

  const contactKeys = useMemo(() => new Set(contacts.map((c) => c.key)), [contacts]);
  const totalUnreadMessages = useMemo(
    () => contacts.reduce((sum, c) => sum + c.unread, 0),
    [contacts],
  );

  const current = filtered.find((c) => c.key === picked) ?? filtered[0] ?? contacts[0];

  // 消息往来旧的在前，像聊天窗口
  const thread = current ? view.phone.messages.filter((m) => m.from === current.key).reverse() : [];
  const pendingForCurrent =
    current && pendingChat?.contact === current.key ? pendingChat.text : null;
  const bubbles = buildChatBubbles(thread, pendingForCurrent);
  const unreadCallIds = new Set(
    view.phone.feedUnread.messages.filter((id) => id.startsWith("phone:call:")),
  );
  const missedCalls = (view.calls?.history ?? []).filter(
    (call) => call.status === "missed" && unreadCallIds.has(`phone:call:${call.id}`),
  );

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [chatErrors, setChatErrors] = useState<Record<string, string>>({});
  const [scrolledUp, setScrolledUp] = useState(false);
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
    setScrolledUp(false);
  }, [scrollSig]);

  const handleListScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    setScrolledUp(gap > 90);
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setScrolledUp(false);
  }, []);

  if (contacts.length === 0 || !current) {
    const knownCount = view.npcs.length;
    return (
      <div className={styles.noContacts}>
        <IncomingCallBanner
          incoming={view.calls?.incoming ?? null}
          busy={busy}
          onAnswerCall={onAnswerCall}
        />
        <div className={styles.emptyWrap}>
          <div className={styles.emptyCard}>
            <CellFrame />
            <Asset id="notify.attention" tint="var(--cp-cyan-dim)" height={24} />
            <span className={styles.emptyKicker}>{"HOLOPHONE // STANDBY"}</span>
            <b className={styles.emptyTitle}>通讯录暂无联系人</b>
            <p className={styles.emptyText}>
              在剧情中与他人交换联系方式，或收到中间人/熟人的加密简讯后，对应频道会自动同步到这里。
            </p>
            {knownCount > 0 && onOpenPeople && (
              <div className={styles.starterRow}>
                <ActionButton onClick={onOpenPeople}>查看已知人物（{knownCount}）</ActionButton>
              </div>
            )}
          </div>
        </div>
        <MissedCalls
          calls={missedCalls}
          contactKeys={contactKeys}
          onReadCall={onReadCall}
          onSelectContact={(key) => {
            setFilter("all");
            setQuery("");
            setPicked(key);
          }}
        />
      </div>
    );
  }

  const actions: PhoneActions = {
    onReply,
    onMessageNpc,
    onSendChat,
    onReadThread,
    onReadCall,
    onAnswerCall,
    chatSending,
    pendingChat,
    busy,
    onLocatePlace,
    onOpenRipperdoc,
  };
  const answeredCall = (view.calls?.history ?? []).find(
    (call) => call.from === current.key && call.status === "answered" && call.endedAt === null,
  );
  const lockInfo = inlineChatLockInfo(current, view, actions);
  const sendingAny = Boolean(chatSending || pendingChat);
  const sendingThis = Boolean(pendingForCurrent !== null || chatSending === current.key);
  const fallbackReply =
    current.alive && lockInfo !== null && !view.combat?.active && !sendingAny ? onReply : undefined;
  const draftText = drafts[current.key] ?? "";
  const currentError = chatErrors[current.key] ?? null;
  const urgentWarning = urgentChatDeadline(view);
  const starters = lockInfo === null ? starterPromptsOf(current) : [];
  const charTone =
    draftText.length >= 290 ? "danger" : draftText.length >= 240 ? "warn" : undefined;

  const fillComposer = (text: string) => {
    clearErrorFor(current.key);
    setDrafts((prev) => ({ ...prev, [current.key]: text }));
    window.requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(text.length, text.length);
    });
  };

  const submitChat = async () => {
    if (lockInfo !== null || sendingAny || !onSendChat) return;
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
    <div className={styles.layout}>
      <aside className={styles.roster} aria-label="联系人筛选与目录">
        <div className={styles.rosterBar}>
          <span className={styles.rosterKicker}>{"HOLOPHONE // LINKS"}</span>
          <span className={styles.rosterStats}>
            {totalUnreadMessages > 0 ? (
              <>
                <b>{totalUnreadMessages}</b> 未读 · {contacts.length} 人
              </>
            ) : (
              `${contacts.length} 联系人`
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
              placeholder="搜姓名、职能、地点…"
              aria-label="搜索联系人"
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

        {tabs.length > 1 && contacts.length > 2 && (
          <fieldset className={styles.filterBar}>
            <legend className={styles.srOnly}>筛选联系人</legend>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={styles.filterBtn}
                data-tone={tab.id === "unread" ? "unread" : undefined}
                aria-pressed={activeFilter === tab.id}
                onClick={() => {
                  setFilter(tab.id);
                  if (tab.id === "unread") {
                    const firstUnread = contacts.find((c) => c.unread > 0);
                    if (firstUnread) setPicked(firstUnread.key);
                  }
                }}
              >
                <span>{tab.label}</span>
                <span className={styles.filterCount}>{tab.count}</span>
              </button>
            ))}
          </fieldset>
        )}

        {filtered.length > 0 ? (
          <ul className={styles.contactList} aria-label="联系人">
            {filtered.map((c) => (
              <ContactRow
                key={c.key}
                contact={c}
                active={c.key === current.key}
                draft={drafts[c.key] ?? ""}
                onSelect={() => setPicked(c.key)}
              />
            ))}
          </ul>
        ) : (
          <div className={styles.rosterEmpty}>
            <span>没有匹配的联系人</span>
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

      <section className={styles.threadPane} aria-label={`和${current.name}的消息`}>
        <IncomingCallBanner
          incoming={view.calls?.incoming ?? null}
          busy={busy}
          onAnswerCall={onAnswerCall}
        />
        {answeredCall && (
          <div className={styles.activeCall} role="status">
            <i className={styles.liveDot} aria-hidden="true" />
            <span>
              全息通话已接通（{answeredCall.at}）— 可直接在下方行动栏与 {answeredCall.name} 对话
            </span>
          </div>
        )}
        <MissedCalls
          calls={missedCalls}
          contactKeys={contactKeys}
          onReadCall={onReadCall}
          onSelectContact={(key) => {
            setFilter("all");
            setQuery("");
            setPicked(key);
          }}
        />

        <ThreadHead
          key={current.key}
          contact={current}
          view={view}
          thread={thread}
          actions={actions}
          lockInfo={lockInfo}
        />

        <div className={styles.chatStage}>
          <span
            className={styles.chatStageGrid}
            style={{ backgroundImage: cssUrl("fx.grid") }}
            aria-hidden="true"
          />
          {bubbles.length === 0 && !sendingThis ? (
            <div className={styles.emptyWrap}>
              <div className={styles.emptyCard}>
                <CellFrame />
                <Asset id="notify.attention" tint="var(--cp-cyan-dim)" height={22} />
                <span className={styles.emptyKicker}>{"CHANNEL // STANDBY"}</span>
                <b className={styles.emptyTitle}>暂无通讯记录</b>
                <p className={styles.emptyText}>
                  {!current.alive
                    ? `${current.name} 的终端已离线。`
                    : current.canChat
                      ? `与 ${current.name} 还没有短讯往来，直接发一句即可接通加密频道。`
                      : "该频道暂无历史消息。"}
                </p>
                {starters.length > 0 && (
                  <div className={styles.starterRow}>
                    {starters.map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        className={styles.starterChip}
                        onClick={() => fillComposer(prompt)}
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              <ul ref={listRef} className={styles.messageList} onScroll={handleListScroll}>
                {bubbles.map((b) => {
                  const showHead = !b.grouped || b.unread || b.pending;
                  const jobStatus =
                    b.job?.status === "offered"
                      ? "offered"
                      : b.job?.status === "active"
                        ? "active"
                        : "closed";
                  return (
                    <li
                      key={b.key}
                      className={styles.messageItem}
                      data-sender={b.sender}
                      data-grouped={b.grouped || undefined}
                    >
                      <div
                        className={b.sender === "player" ? styles.bubblePlayer : styles.bubbleNpc}
                        data-unread={b.unread || undefined}
                        data-pending={b.pending || undefined}
                      >
                        {showHead && (
                          <p className={styles.bubbleHead}>
                            {!b.grouped && (
                              <span
                                className={
                                  b.sender === "player" ? styles.senderPlayer : styles.senderNpc
                                }
                              >
                                {b.sender === "player" ? "你" : current.name}
                              </span>
                            )}
                            {b.unread && <UnreadBadge>新</UnreadBadge>}
                            {b.at && <time className={styles.bubbleTime}>{b.at}</time>}
                          </p>
                        )}
                        <p className={styles.bubbleText}>
                          {b.text}
                          {!showHead && b.at && (
                            <time className={styles.bubbleTimeInline}>{b.at}</time>
                          )}
                        </p>
                        {b.job && (
                          <div className={styles.jobCard} data-status={jobStatus}>
                            <div className={styles.jobCardHead}>
                              <span className={styles.jobCardTitle}>
                                <Asset
                                  id="notify.questUpdate"
                                  tint={
                                    jobStatus === "offered"
                                      ? "var(--cp-yellow)"
                                      : jobStatus === "active"
                                        ? "var(--cp-cyan)"
                                        : "var(--cp-text-dim)"
                                  }
                                  height={13}
                                />
                                <span>
                                  {b.job.status === "offered"
                                    ? `来活提议 · ${b.job.title}`
                                    : b.job.status === "active"
                                      ? `已接手 · ${b.job.title}`
                                      : `${b.job.statusLabel} · ${b.job.title}`}
                                </span>
                              </span>
                            </div>
                            <span className={styles.jobCardMeta}>
                              {b.job.reward > 0 && (
                                <span className={styles.jobReward}>
                                  {b.job.reward.toLocaleString("en-US")} €$
                                </span>
                              )}
                              {b.job.due && <span>{b.job.due} 前</span>}
                              {b.job.status === "offered" && (
                                <span>
                                  {lockInfo === null
                                    ? "下方私信答应即可接单"
                                    : view.combat?.active
                                      ? "脱战后私信即可答应接单"
                                      : "点「回复」在行动框里答应即可接进追踪"}
                                </span>
                              )}
                            </span>
                            {b.job.status === "offered" && (
                              <span
                                style={{ display: "inline-flex", gap: "0.45rem", flexWrap: "wrap" }}
                              >
                                {onAcceptJob && !busy && !view.death && !view.ended && (
                                  <button
                                    type="button"
                                    className={styles.jobQuickBtn}
                                    onClick={() => b.job && onAcceptJob(b.job.id)}
                                  >
                                    直接接下这单
                                  </button>
                                )}
                                {lockInfo === null && (
                                  <button
                                    type="button"
                                    className={styles.jobQuickBtn}
                                    onClick={() =>
                                      fillComposer(
                                        `「${b.job?.title ?? "这单"}」我接了，具体细节发我。`,
                                      )
                                    }
                                  >
                                    私信答应
                                  </button>
                                )}
                              </span>
                            )}
                          </div>
                        )}
                        {((b.fallbackId !== null && fallbackReply) || b.ack) && (
                          <div className={styles.bubbleFoot}>
                            {b.ack && <span className={styles.bubbleAck}>已回复</span>}
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
                  <li className={styles.messageItem} data-sender="npc">
                    <div
                      className={`${styles.bubbleNpc} ${styles.typingBubble}`}
                      aria-live="polite"
                    >
                      <span className={styles.senderNpc}>{current.name}</span>
                      <span className={styles.typingLabel}>正在加密回信</span>
                      <span
                        className={styles.typingDots}
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
              {scrolledUp && (
                <button
                  type="button"
                  className={styles.scrollDownBtn}
                  onClick={scrollToBottom}
                  aria-label="滚动到最新消息"
                >
                  ↓ 最新消息
                </button>
              )}
            </>
          )}
        </div>

        <footer className={styles.composerWrap}>
          {urgentWarning && lockInfo === null && (
            <p className={styles.dueWarn}>
              <Asset id="notify.attention" tint="var(--cp-yellow)" height={13} />
              <span>
                紧急约定「{urgentWarning.title}」仅剩 {urgentWarning.left} 分钟（每轮短讯耗时 1–3
                分钟）
              </span>
            </p>
          )}
          {currentError && (
            <p className={styles.composerError} role="alert">
              <Asset id="notify.warning" tint="var(--cp-red)" height={13} />
              <span>{currentError}</span>
            </p>
          )}
          {lockInfo !== null ? (
            <p className={styles.composerLock} data-tone={lockInfo.tone}>
              <Asset
                id={lockInfo.tone === "danger" ? "notify.warning" : "notify.attention"}
                tint={
                  lockInfo.tone === "danger"
                    ? "var(--cp-red)"
                    : lockInfo.tone === "busy"
                      ? "var(--cp-cyan)"
                      : "var(--cp-text-dim)"
                }
                height={13}
              />
              <span>{lockInfo.reason}</span>
            </p>
          ) : (
            <form
              className={styles.composerForm}
              onSubmit={(e) => {
                e.preventDefault();
                void submitChat();
              }}
            >
              <div className={styles.composerRow}>
                <span className={styles.inputBox}>
                  <CellFrame />
                  <textarea
                    ref={inputRef}
                    className={styles.input}
                    rows={1}
                    maxLength={MAX_MESSAGE_LEN}
                    placeholder={
                      sendingThis
                        ? `${current.name} 正在回信…可先输入下一句`
                        : `给 ${current.name} 发加密短讯…`
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
                </span>
                <button
                  type="submit"
                  className={styles.sendBtn}
                  disabled={sendingAny || draftText.trim() === ""}
                  title="Enter 发送（每轮消耗 1–3 分钟，不在手机内做检定或完单结算）"
                >
                  {sendingThis ? "回信中…" : "发送"}
                </button>
              </div>
              <div className={styles.composerFoot}>
                <span>Enter 发送 · Shift+Enter 换行 · 耗时 1–3 分钟</span>
                <span className={styles.charCount} data-tone={charTone}>
                  {draftText.length}/{MAX_MESSAGE_LEN}
                </span>
              </div>
            </form>
          )}
        </footer>
      </section>
    </div>
  );
}
