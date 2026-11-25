import type { Draft } from "immer";
import type { ApplyOutcome } from "../../kernel/system";
import type { WorldState } from "../../kernel/world";
import {
  CALL_RING_MINUTES,
  CALL_STATUS_LABELS,
  CALLS_KEPT,
  type ChatMeta,
  type ContactSource,
  type Message,
  PHONE_KEPT,
  PHONE_THREAD_MIN,
  type PhoneState,
  PhoneStateSchema,
} from "./schema";

/** 幂等写入通讯录：已有记录时仅按需补充 note，不覆盖最初来源 */
export function addContact(
  draft: Draft<PhoneState>,
  id: string,
  name: string,
  source: ContactSource,
  now: number,
  note?: string,
  silent = false,
): ApplyOutcome {
  const existing = draft.contacts[id];
  if (existing) {
    if (note !== undefined && existing.note === undefined) {
      existing.note = note;
    }
    return { ok: true };
  }
  draft.contacts[id] = {
    addedAt: now,
    source,
    ...(note === undefined ? {} : { note }),
  };
  return {
    ok: true,
    ...(silent ? {} : { notes: [`已添加 ${name} 到通讯录`] }),
  };
}

/** 从通讯录移除联系人（剧情拉黑/删号） */
export function removeContact(draft: Draft<PhoneState>, id: string, name: string): ApplyOutcome {
  if (draft.contacts[id] === undefined) return { ok: true };
  delete draft.contacts[id];
  return { ok: true, notes: [`已从通讯录移除 ${name}`] };
}

function isProtectedJobMessage(m: Message, openJobIds: ReadonlySet<string>): boolean {
  return m.job !== undefined && openJobIds.has(m.job);
}

/** 超过总上限时淘汰最旧消息，优先保住各会话最近几条以及未结束的派单附件消息 */
function trimMessages(messages: Message[], openJobIds: ReadonlySet<string>): void {
  if (messages.length <= PHONE_KEPT) return;
  const counts = new Map<string, number>();
  for (const m of messages) counts.set(m.from, (counts.get(m.from) ?? 0) + 1);

  const dropAt = (index: number) => {
    const [removed] = messages.splice(index, 1);
    if (removed) counts.set(removed.from, (counts.get(removed.from) ?? 1) - 1);
  };

  while (messages.length > PHONE_KEPT) {
    const excessIdx = messages.findIndex(
      (m) => !isProtectedJobMessage(m, openJobIds) && (counts.get(m.from) ?? 0) > PHONE_THREAD_MIN,
    );
    if (excessIdx >= 0) {
      dropAt(excessIdx);
      continue;
    }
    const nonJobIdx = messages.findIndex((m) => !isProtectedJobMessage(m, openJobIds));
    if (nonJobIdx >= 0) {
      dropAt(nonJobIdx);
      continue;
    }
    dropAt(0);
  }
}

export function receiveMessage(
  draft: Draft<PhoneState>,
  from: string,
  name: string,
  text: string,
  now: number,
  job?: string,
  openJobIds: ReadonlySet<string> = new Set(),
): ApplyOutcome {
  if (draft.contacts[from] === undefined) {
    draft.contacts[from] = { addedAt: now, source: "inbound" };
  }
  draft.messages.push({
    id: draft.nextId,
    from,
    name,
    sender: "npc",
    text,
    at: now,
    read: false,
    replied: false,
    ...(job === undefined ? {} : { job }),
  });
  draft.nextId += 1;
  trimMessages(draft.messages, openJobIds);
  return { ok: true, notes: [`消息：${name}：${text}`] };
}

/** 手机直聊发出玩家的消息：把同一会话里未读短信顺手标成已读，再写入发件记录 */
export function sendPlayerMessage(
  draft: Draft<PhoneState>,
  to: string,
  name: string,
  text: string,
  now: number,
  openJobIds: ReadonlySet<string> = new Set(),
): ApplyOutcome {
  for (const m of draft.messages) {
    if (m.from === to && !m.read) m.read = true;
  }
  draft.messages.push({
    id: draft.nextId,
    from: to,
    name,
    sender: "player",
    text,
    at: now,
    read: true,
    replied: true,
  });
  draft.nextId += 1;
  trimMessages(draft.messages, openJobIds);
  return { ok: true, notes: [`发给 ${name}：${text}`] };
}

/** 记录本场景同人物手机私聊的轮数与派单占用，同时清理过期场景条目 */
export function applyChatMeta(draft: Draft<PhoneState>, command: ChatMeta): ApplyOutcome {
  for (const [key, entry] of Object.entries(draft.chatBudget)) {
    if (entry.scene < command.scene) delete draft.chatBudget[key];
  }
  const prev = draft.chatBudget[command.npc];
  const base =
    prev && prev.scene === command.scene
      ? prev
      : { scene: command.scene, turns: 0, jobOffered: false, jobsOffered: 0 };
  const prevCount = base.jobsOffered ?? (base.jobOffered ? 1 : 0);
  const nextCount = prevCount + (command.jobOffered ? 1 : 0);
  draft.chatBudget[command.npc] = {
    scene: command.scene,
    turns: base.turns + 1,
    jobOffered: nextCount > 0,
    jobsOffered: nextCount,
  };
  return { ok: true };
}

/**
 * 标已读：没给 feed 时把人发来的消息全标上（打开消息记录）；
 * 给了就只标这几条（打开某个频道），人发来的按 phone:message:编号 对上，别的来源记进 feedRead
 */
export function readAll(draft: Draft<PhoneState>, feed?: readonly string[]): ApplyOutcome {
  let n = 0;
  const own = feed?.flatMap((id) => {
    const match = /^phone:message:(\d+)$/.exec(id);
    return match ? [Number(match[1])] : [];
  });
  for (const m of draft.messages) {
    if (!m.read && (own === undefined || own.includes(m.id))) {
      m.read = true;
      n += 1;
    }
  }
  const read = new Set(draft.feedRead);
  for (const id of feed ?? []) {
    if (id.startsWith("phone:message:") || read.has(id)) continue;
    read.add(id);
    n += 1;
  }
  // 只留最近标的那些：各频道能看到的消息加起来远少于这个数，早就滚出去的不用记
  if (read.size !== draft.feedRead.length) draft.feedRead = [...read].slice(-FEED_READ_KEPT);
  return { ok: true, notes: n > 0 ? [`看了 ${n} 条消息`] : [] };
}

/** 别的频道已读的 id 最多记这么多条 */
export const FEED_READ_KEPT = 400;

export function replyMessage(
  draft: Draft<PhoneState>,
  id: number,
  text: string | undefined,
  now: number,
): ApplyOutcome {
  const m = draft.messages.find((x) => x.id === id);
  if (!m) return { ok: false, reason: `消息记录里没有第 ${id} 条消息` };
  m.read = true;
  m.replied = true;
  if (text !== undefined) {
    m.reply = text;
    m.repliedAt = now;
  }
  return { ok: true, notes: [`回复${m.name}的消息`] };
}

/** 有人打来全息电话：同一时间只响一通，已经在响的不叠加 */
export function receiveCall(
  draft: Draft<PhoneState>,
  from: string,
  name: string,
  about: string,
  now: number,
): ApplyOutcome {
  if (draft.calls.some((c) => c.status === "ringing")) {
    return { ok: false, reason: "已经有一通全息电话在响，先接或拒接" };
  }
  if (draft.contacts[from] === undefined) {
    draft.contacts[from] = { addedAt: now, source: "inbound" };
  }
  draft.calls.push({
    id: draft.nextCall,
    from,
    name,
    about,
    at: now,
    status: "ringing",
    endedAt: null,
  });
  draft.nextCall += 1;
  while (draft.calls.length > CALLS_KEPT) draft.calls.shift();
  return { ok: true, notes: [`全息电话：${name}打来了`] };
}

/** 玩家接起或拒接正在响的那通；过了时限的已经算没接 */
export function answerCall(
  draft: Draft<PhoneState>,
  id: number,
  answer: boolean,
  now: number,
): ApplyOutcome {
  const call = draft.calls.find((c) => c.id === id);
  if (!call) return { ok: false, reason: `通话记录里没有第 ${id} 通` };
  if (call.status !== "ringing")
    return { ok: false, reason: `这通全息电话已经${CALL_STATUS_LABELS[call.status]}` };
  call.status = answer ? "answered" : "declined";
  call.endedAt = now;
  return {
    ok: true,
    notes: [answer ? `接起了${call.name}的全息电话` : `拒接了${call.name}的全息电话`],
  };
}

/** 时间推进：响过时限还没接的记成没接 */
export function tickCalls(draft: Draft<PhoneState>, to: number): void {
  for (const call of draft.calls) {
    if (call.status === "ringing" && to - call.at >= CALL_RING_MINUTES) {
      call.status = "missed";
      call.endedAt = call.at + CALL_RING_MINUTES;
    }
  }
}

/** 后端在调模型前检查：要回复的消息得还在消息记录里 */
export function replyBlock(world: WorldState, id: number): string | undefined {
  const phone = PhoneStateSchema.parse(world.slices.phone ?? {});
  return phone.messages.some((m) => m.id === id) ? undefined : `消息记录里没有第 ${id} 条消息`;
}
