import { useState } from "react";
import { ActionButton } from "../../ui/ActionButton";
import { Asset, NineSlice } from "../../ui/Asset";
import { useLayer } from "../../ui/layers";
import { portraitOf } from "./art";
import { ProfileHead } from "./Profile";
import styles from "./story.module.css";
import type { View } from "./view";

type Npc = View["npcs"][number];

interface Contact {
  /** 消息的 from；没有消息往来的人物用人物 id */
  readonly key: string;
  readonly name: string;
  readonly npc: Npc | undefined;
  readonly last: string | null;
  readonly unread: number;
}

/** 联系人：先是有消息往来的（最后联系的在前），再是见过面但没发过消息的人 */
function contactsOf(view: View): Contact[] {
  const byId = new Map(view.npcs.map((n) => [n.id, n]));
  const listed = view.phone.contacts.map((c) => ({
    key: c.from,
    name: c.name,
    npc: c.npc === null ? undefined : byId.get(c.npc),
    last: c.last,
    unread: c.unread,
  }));
  const seen = new Set(listed.map((c) => c.key));
  const rest = view.npcs
    .filter((n) => !seen.has(n.id))
    .map((n) => ({ key: n.id, name: n.name, npc: n, last: n.lastSeen, unread: 0 }));
  return [...listed, ...rest];
}

/** 头像：有原作头像（avatars 图集）的人物用原作图，没有的（曼因、丽贝卡、法拉第等）用名字的第一个字 */
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
      {portrait ? <Asset id={portrait} className={styles.avatarArt} /> : ([...name][0] ?? "?")}
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

/**
 * 消息区顶上的窄标题栏（用户定的，计划第十二节第 14 条）：私信页以联系人和消息为主，档案是次要的，
 * 不再常驻右栏；鼠标停到头像上、键盘聚焦头像或点一下头像时才弹出浮层，移开、失焦或按 Esc 收起
 */
function ThreadHead({ contact }: { readonly contact: Contact }) {
  const { npc } = contact;
  const [open, setOpen] = useState(false);
  // 浮层开着时 Esc 先收浮层，没开时交给神经界面关闭
  useLayer(() => setOpen(false), open);
  return (
    <header className={styles.threadHead}>
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
      <span className={styles.contactName}>
        <b>{contact.name}</b>
        <small className={styles.dim}>{statusOf(npc)}</small>
      </span>
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

  if (contacts.length === 0 || !current) return <p className={styles.dim}>还没有联系人。</p>;

  return (
    <div className={styles.phoneLayout}>
      <ul className={styles.contactList} aria-label="联系人">
        {contacts.map((c) => (
          <li key={c.key}>
            <button
              type="button"
              className={styles.contact}
              aria-pressed={c.key === current.key}
              onClick={() => setPicked(c.key)}
            >
              <Avatar npc={c.npc?.id} name={c.name} dead={c.npc?.alive === false} />
              <span className={styles.contactName}>
                <b>{c.name}</b>
                <small className={styles.dim}>
                  {!c.npc
                    ? "没有档案"
                    : c.npc.met
                      ? `好感 ${c.npc.affinity > 0 ? "+" : ""}${c.npc.affinity}`
                      : "只听说过"}
                  {c.last ? ` · ${c.last}` : ""}
                </small>
              </span>
              {c.unread > 0 && <UnreadBadge>{c.unread}</UnreadBadge>}
            </button>
          </li>
        ))}
      </ul>
      <div className={styles.docBody}>
        <section aria-label={`和${current.name}的消息`}>
          {/* 顶上一条窄标题栏：头像、名字、状态；档案收在头像上，停一下才弹出来，不常驻占位（用户定的，计划第十二节第 14 条） */}
          <ThreadHead key={current.key} contact={current} />
          {thread.length === 0 ? (
            <p className={styles.dim}>还没有消息往来。</p>
          ) : (
            <ul className={styles.phoneList}>
              {thread.map((m) => (
                <li key={m.id} className={styles.phoneItem} data-unread={!m.read || undefined}>
                  <p className={styles.phoneHead}>
                    <small>{m.at}</small>
                  </p>
                  <p className={styles.phoneText}>{m.text}</p>
                  {m.reply && (
                    <p className={styles.phoneReply}>
                      <small className={styles.dim}>
                        你回{m.repliedAt ? `（${m.repliedAt}）` : ""}：
                      </small>
                      {m.reply}
                    </p>
                  )}
                  {m.replied && !m.reply && <small className={styles.dim}>已回复</small>}
                  {onReply && current.npc?.alive !== false && (
                    <ActionButton onClick={() => onReply(m.id)}>回复</ActionButton>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
