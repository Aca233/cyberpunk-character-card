import { useEffect, useState } from "react";
import { ActionButton } from "../../ui/ActionButton";
import { Button } from "../../ui/Button";
import { Panel } from "../../ui/Panel";
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

/** 头像：还没有原作头像素材和分层 SVG，先用名字的第一个字 */
function Avatar({ name, dead }: { readonly name: string; readonly dead: boolean }) {
  return (
    <span className={styles.avatar} data-dead={dead || undefined} aria-hidden="true">
      {[...name][0] ?? "?"}
    </span>
  );
}

/** 人物档案：你知道的信息、关系笔记、人情和仇、共同记忆；诉求、底线和秘密不在这里 */
function Profile({ npc }: { readonly npc: Npc }) {
  return (
    <section aria-label={`${npc.name}的档案`}>
      <h3 className={styles.mapTitle}>档案</h3>
      <div className={styles.factionCard}>
        <div className={styles.factionHead}>
          <b>{npc.name}</b>
          {npc.alias && <span className={styles.dim}>外号{npc.alias}</span>}
          <span className={styles.dim}>
            {!npc.alive
              ? "已故"
              : !npc.met
                ? "只听说过"
                : npc.here
                  ? "在场"
                  : npc.lastSeen
                    ? `最后见面 ${npc.lastSeen}`
                    : "不在场"}
          </span>
        </div>
        {npc.met ? (
          <>
            <p className={styles.factionLine}>
              {npc.role} · {npc.pronoun} · 好感 {npc.affinity > 0 ? "+" : ""}
              {npc.affinity}
            </p>
            <p className={styles.factionLine}>{npc.look}</p>
          </>
        ) : (
          <p className={styles.dim}>还没见过面，下面是听来的。</p>
        )}
        <p className={styles.npcMemoryTitle}>你知道的</p>
        {npc.known.length === 0 ? (
          <p className={styles.dim}>除了见面看到的，还没打听到什么。</p>
        ) : (
          <ul className={styles.memoryBonds}>
            {npc.known.map((k) => (
              <li key={k.text} className={styles.factionLine}>
                <span className={styles.memoryTag}>{k.sourceLabel}</span> {k.text}
                <small className={styles.dim}>（{k.at}）</small>
              </li>
            ))}
          </ul>
        )}
        <p className={styles.factionReason}>关系：{npc.relation ?? "还说不上什么关系。"}</p>
        {npc.ledger.length > 0 && (
          <>
            <p className={styles.npcMemoryTitle}>人情和仇</p>
            <ul className={styles.memoryBonds}>
              {npc.ledger.map((e) => (
                <li
                  key={`${e.at}|${e.kind}|${e.text}`}
                  className={styles.factionLine}
                  data-settled={e.settled !== null || undefined}
                >
                  <span className={styles.memoryTag}>{e.label}</span> {e.text}
                  <small className={styles.dim}>
                    （{e.at}
                    {e.settled !== null && `，${e.settled} 了结${e.how ? `：${e.how}` : ""}`}）
                  </small>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className={styles.npcMemoryTitle}>共同记忆</p>
        {npc.memories.length === 0 ? (
          <p className={styles.dim}>还没有记录。</p>
        ) : (
          <ul className={styles.memoryBonds}>
            {npc.memories.map((m) => (
              <li key={m} className={styles.factionLine}>
                {m}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** 消息：左边联系人，右边和这个人的消息往来，见过面的人下面是人物档案。不调用模型 */
export function PhoneDialog({
  view,
  onReply,
  onClose,
}: {
  readonly view: View;
  /** 回复一条：输入框进入回复状态；正在生成时不传，按钮不显示 */
  readonly onReply?: ((id: number) => void) | undefined;
  readonly onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const contacts = contactsOf(view);
  const [picked, setPicked] = useState<string | null>(
    () => (contacts.find((c) => c.unread > 0) ?? contacts[0])?.key ?? null,
  );
  const current = contacts.find((c) => c.key === picked) ?? contacts[0];
  // 消息往来旧的在前，像聊天窗口
  const thread = current ? view.phone.messages.filter((m) => m.from === current.key).reverse() : [];

  return (
    <div className={styles.journalBackdrop}>
      <div role="dialog" aria-label="消息" className={styles.journal}>
        <Panel as="div" title="消息" line="var(--cp-cyan)">
          <div className={styles.docHead}>
            <p className={`${styles.dim} ${styles.docNote}`}>
              {view.phone.unread > 0 ? `${view.phone.unread} 条未读。` : "没有未读消息。"}
              回复一条消息算一轮行动。
            </p>
            <Button onClick={onClose}>关上</Button>
          </div>
          {contacts.length === 0 || !current ? (
            <p className={styles.dim}>还没有联系人：见过面或者发过消息的人会出现在这里。</p>
          ) : (
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
                      <Avatar name={c.name} dead={c.npc?.alive === false} />
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
                      {c.unread > 0 && <span className={styles.contactUnread}>{c.unread}</span>}
                    </button>
                  </li>
                ))}
              </ul>
              <div className={styles.docBody}>
                <section aria-label={`和${current.name}的消息`}>
                  <h3 className={styles.mapTitle}>{current.name}</h3>
                  {thread.length === 0 ? (
                    <p className={styles.dim}>还没有消息往来。</p>
                  ) : (
                    <ul className={styles.phoneList}>
                      {thread.map((m) => (
                        <li
                          key={m.id}
                          className={styles.phoneItem}
                          data-unread={!m.read || undefined}
                        >
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
                {current.npc && <Profile npc={current.npc} />}
              </div>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
