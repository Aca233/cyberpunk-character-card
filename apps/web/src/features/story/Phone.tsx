import { useState } from "react";
import { ActionButton } from "../../ui/ActionButton";
import { Asset, cssUrl, NineSlice } from "../../ui/Asset";
import { CellFrame } from "../../ui/FrameBox";
import { useLayer } from "../../ui/layers";
import { portraitOf } from "./art";
import { ProfileHead } from "./Profile";
import styles from "./story.module.css";
import type { View } from "./view";

type Npc = View["npcs"][number];
type PhoneMessage = View["phone"]["messages"][number];

const CELL_SLICE = [20, 30, 30, 20] as const;

interface Contact {
  /** 消息的 from；没有消息往来的人物用人物 id */
  readonly key: string;
  readonly name: string;
  readonly npc: Npc | undefined;
  readonly last: string | null;
  readonly unread: number;
  readonly preview: string | null;
}

/** 联系人：先是有消息往来的（最后联系的在前），再是见过面但没发过消息的人 */
function contactsOf(view: View): Contact[] {
  const byId = new Map(view.npcs.map((n) => [n.id, n]));
  const latestByFrom = new Map<string, PhoneMessage>();
  for (const m of view.phone.messages) {
    if (!latestByFrom.has(m.from)) latestByFrom.set(m.from, m);
  }
  const listed = view.phone.contacts.map((c) => ({
    key: c.from,
    name: c.name,
    npc: c.npc === null ? undefined : byId.get(c.npc),
    last: c.last,
    unread: c.unread,
    preview: latestByFrom.get(c.from)?.text ?? null,
  }));
  const seen = new Set(listed.map((c) => c.key));
  const rest = view.npcs
    .filter((n) => !seen.has(n.id))
    .map((n) => ({
      key: n.id,
      name: n.name,
      npc: n,
      last: n.lastSeen,
      unread: 0,
      preview: latestByFrom.get(n.id)?.text ?? null,
    }));
  return [...listed, ...rest];
}

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
  const portrait = portraitOf(npc);
  return (
    <span
      className={styles.avatar}
      data-dead={dead || undefined}
      data-portrait={portrait ? true : undefined}
      aria-hidden="true"
    >
      <NineSlice
        id="map.filterCellBg"
        tint="var(--box-fill, rgb(14 14 23 / 78%))"
        slice={CELL_SLICE}
      />
      {portrait ? (
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

/** 标题栏里的一句状态，写法同档案头的状态牌 */
function statusOf(npc: Npc | undefined): string {
  if (!npc) return "没有档案";
  if (!npc.alive) return "已故";
  if (!npc.met) return npc.nemesis ? "交过手" : "只听说过";
  if (npc.here) return "在场";
  return npc.lastSeen ? `最后见面 ${npc.lastSeen}` : "不在场";
}

/** 浮层照原作世界地图默认 tooltip 的三层（阴影、底、框），切线同 MapPanel 的 TOOLTIP_SLICE / SHADOW_SLICE */
const TIP_SLICE = [10, 30, 70, 10] as const;
const TIP_SHADOW_SLICE = 20;

/** 联系人的好感数字：正数带加号 */
function affinityLabel(n: number): string {
  return `好感 ${n > 0 ? "+" : ""}${n}`;
}

/**
 * 消息区顶上的窄标题栏（用户定的，计划第十二节第 14 条）：私信页以联系人和消息为主，档案是次要的，
 * 不再常驻右栏；鼠标停到头像上、键盘聚焦头像或点一下头像时才弹出浮层，移开、失焦或按 Esc 收起
 */
function ThreadHead({ contact, count }: { readonly contact: Contact; readonly count: number }) {
  const { npc } = contact;
  const [open, setOpen] = useState(false);
  // 浮层开着时 Esc 先收浮层，没开时交给神经界面关闭
  useLayer(() => setOpen(false), open);
  const metaParts: string[] = [];
  if (npc?.met && npc.role) metaParts.push(npc.role);
  metaParts.push(statusOf(npc));
  if (npc?.met) metaParts.push(affinityLabel(npc.affinity));
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
                {/* 只放档案头：头像、名字、状态牌、一行信息；页签和各栏在在场块里看，这里不塞（用户定的，计划第十二节第 14 条） */}
                <div className={styles.threadCardBody}>
                  <ProfileHead npc={npc} />
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
            {npc?.alias && <span className={styles.threadAlias}>{npc.alias}</span>}
          </span>
          <small className={styles.threadMeta}>{metaParts.join(" · ")}</small>
        </span>
        <span className={styles.threadAside}>
          {count > 0 && <span className={styles.threadCount}>{count} 条</span>}
          {npc && (
            <span
              className={styles.threadSignal}
              data-state={!npc.alive ? "dead" : npc.here ? "here" : "idle"}
            >
              {!npc.alive ? "离线" : npc.here ? "在场" : "待机"}
            </span>
          )}
        </span>
      </div>
      <span
        className={styles.threadRule}
        style={{ maskImage: cssUrl("tab.line"), WebkitMaskImage: cssUrl("tab.line") }}
        aria-hidden
      />
    </header>
  );
}

/** 消息页的私信栏：左边联系人，右边和这个人的消息往来；档案收在标题栏头像的浮层里。不调用模型 */
export function PhoneBody({
  view,
  onReply,
}: {
  readonly view: View;
  /** 回复一条：输入框进入回复状态；正在生成时不传，按钮不显示 */
  readonly onReply?: ((id: number) => void) | undefined;
}) {
  const contacts = contactsOf(view);
  const [picked, setPicked] = useState<string | null>(
    () => (contacts.find((c) => c.unread > 0) ?? contacts[0])?.key ?? null,
  );
  const current = contacts.find((c) => c.key === picked) ?? contacts[0];
  // 消息往来旧的在前，像聊天窗口
  const thread = current ? view.phone.messages.filter((m) => m.from === current.key).reverse() : [];

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

  return (
    <div className={styles.phoneLayout}>
      <ul className={styles.contactList} aria-label="联系人">
        {contacts.map((c) => {
          const dead = c.npc?.alive === false;
          const affinityTone =
            c.npc?.met && c.npc.affinity < 0
              ? "neg"
              : c.npc?.met && c.npc.affinity > 0
                ? "pos"
                : undefined;
          const fallbackMeta = !c.npc
            ? "没有档案"
            : dead
              ? "已故"
              : c.npc.met
                ? `${affinityLabel(c.npc.affinity)}${c.last ? ` · ${c.last}` : ""}`
                : `只听说过${c.last ? ` · ${c.last}` : ""}`;
          return (
            <li key={c.key}>
              <button
                type="button"
                className={styles.contact}
                aria-pressed={c.key === current.key}
                data-dead={dead || undefined}
                onClick={() => setPicked(c.key)}
              >
                <Avatar npc={c.npc?.id} name={c.name} dead={dead} />
                <span className={styles.contactName}>
                  <span className={styles.contactTop}>
                    <b className={styles.contactTitle}>{c.name}</b>
                    {c.npc?.here && c.npc.alive && <span className={styles.contactHere}>在场</span>}
                  </span>
                  <small
                    className={styles.contactSub}
                    data-affinity={c.preview ? undefined : affinityTone}
                  >
                    {c.preview ?? fallbackMeta}
                  </small>
                </span>
                {c.unread > 0 && <UnreadBadge>{c.unread}</UnreadBadge>}
              </button>
            </li>
          );
        })}
      </ul>
      <section className={styles.threadPane} aria-label={`和${current.name}的消息`}>
        {/* 顶上一条窄标题栏：头像、名字、状态；档案收在头像上，停一下才弹出来，不常驻占位（用户定的，计划第十二节第 14 条） */}
        <ThreadHead key={current.key} contact={current} count={thread.length} />
        {thread.length === 0 ? (
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
                      ? `与 ${current.name} 还没有短讯往来，有新来讯时会第一时间送达。`
                      : "尚未建立直接加密连线。"
                  : "该频道暂无历史消息。"}
              </p>
            </div>
          </div>
        ) : (
          <ul className={styles.phoneList}>
            {thread.map((m) => (
              <li key={m.id} className={styles.phoneItem}>
                <div className={styles.phoneBubble} data-unread={!m.read || undefined}>
                  <CellFrame />
                  <p className={styles.phoneHead}>
                    <span className={styles.phoneSender}>{current.name}</span>
                    {!m.read && <UnreadBadge>新</UnreadBadge>}
                    <time className={styles.phoneTime}>{m.at}</time>
                  </p>
                  <p className={styles.phoneText}>{m.text}</p>
                  {(onReply && current.npc?.alive !== false) || (m.replied && !m.reply) ? (
                    <div className={styles.phoneItemFoot}>
                      {m.replied && !m.reply && <span className={styles.phoneAck}>已回复</span>}
                      {onReply && current.npc?.alive !== false && (
                        <ActionButton onClick={() => onReply(m.id)}>回复</ActionButton>
                      )}
                    </div>
                  ) : null}
                </div>
                {m.reply && (
                  <div className={styles.phoneReply}>
                    <CellFrame />
                    <p className={styles.phoneHead}>
                      <span className={styles.phoneReplySender}>你</span>
                      {m.repliedAt && <time className={styles.phoneTime}>{m.repliedAt}</time>}
                    </p>
                    <p className={styles.phoneText}>{m.reply}</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
