import type { FeedItem, ViewContext } from "../../kernel/system";
import { isOpen, JOB_STATUS_LABELS, JobsStateSchema } from "../jobs";
import { deathKnown, NpcStateSchema } from "../npc";
import { formatGameTime } from "../world";
import { PHONE_THREAD_MIN, PhoneStateSchema } from "./schema";

/** 界面上最多列几条消息（先保每个会话最近几条和关联未结委托，再补最近消息） */
const PHONE_SHOWN = 60;

/** 各频道未读消息的 id；打开频道后交回 readMessages 标已读 */
export function phoneFeedUnread(feed: readonly FeedItem[]) {
  return {
    messages: feed.filter((i) => i.unread && i.channel === "messages").map((i) => i.id),
    news: feed.filter((i) => i.unread && i.channel === "news").map((i) => i.id),
    street: feed.filter((i) => i.unread && i.channel === "street").map((i) => i.id),
  };
}

/** 按逆时间选出要给界面的消息，确保每个联系人的最近往来与进行中委托消息不被单一话痨线程挤掉 */
function selectShownMessages(
  messages: PhoneState["messages"],
  jobs: Map<string, ReturnType<typeof JobsStateSchema.parse>["jobs"][number]>,
) {
  const newestFirst = [...messages].reverse();
  const picked = new Set<number>();
  const threadCount = new Map<string, number>();

  for (const m of newestFirst) {
    if (picked.size >= PHONE_SHOWN) break;
    const linked = m.job === undefined ? undefined : jobs.get(m.job);
    const openLinked = linked !== undefined && isOpen(linked);
    const seen = threadCount.get(m.from) ?? 0;
    if (openLinked || seen < PHONE_THREAD_MIN) {
      picked.add(m.id);
      threadCount.set(m.from, seen + 1);
    }
  }

  for (const m of newestFirst) {
    if (picked.size >= PHONE_SHOWN) break;
    picked.add(m.id);
  }

  return newestFirst.filter((m) => picked.has(m.id));
}

type PhoneState = ReturnType<typeof PhoneStateSchema.parse>;

/** 消息和联系人；只展示玩家知道的生死，不暴露场外死亡 */
export function phoneMessagesView({ world }: ViewContext) {
  const phoneState = PhoneStateSchema.parse(world.slices.phone ?? {});
  const npcs = NpcStateSchema.parse(world.slices.npc);
  const jobsState = JobsStateSchema.parse(world.slices.jobs);
  const jobs = new Map(jobsState.jobs.map((j) => [j.id, j]));
  const shown = selectShownMessages(phoneState.messages, jobs);
  return {
    unread: phoneState.messages.filter((m) => m.sender !== "player" && !m.read).length,
    messages: shown.map((m) => {
      const linked = m.job === undefined ? undefined : jobs.get(m.job);
      return {
        id: m.id,
        from: m.from,
        name: m.name,
        sender: m.sender,
        text: m.text,
        job: linked
          ? {
              id: linked.id,
              title: linked.title,
              status: linked.status,
              statusLabel: JOB_STATUS_LABELS[linked.status],
              reward: linked.reward,
              due: linked.due === null ? null : formatGameTime(linked.due),
            }
          : null,
        at: formatGameTime(m.at),
        atMinutes: m.at,
        read: m.read,
        replied: m.replied,
        reply: m.reply ?? null,
        repliedAt: m.repliedAt === undefined ? null : formatGameTime(m.repliedAt),
      };
    }),
    /** 通讯录联系人：仅包含已交换联系方式或已有通讯往来的人物/频道；未读与最近往来在前 */
    contacts: (() => {
      const latestMsg = new Map<string, (typeof phoneState.messages)[number]>();
      for (const m of phoneState.messages) latestMsg.set(m.from, m);
      const latestCall = new Map<string, (typeof phoneState.calls)[number]>();
      for (const c of phoneState.calls) latestCall.set(c.from, c);

      const keys = new Set<string>([
        ...Object.keys(phoneState.contacts),
        ...latestMsg.keys(),
        ...latestCall.keys(),
      ]);

      return [...keys]
        .map((from) => {
          const entry = phoneState.contacts[from];
          const msg = latestMsg.get(from);
          const call = latestCall.get(from);
          const npc = npcs.npcs[from];
          const fixer = jobsState.fixers[from];
          const unread = phoneState.messages.filter(
            (x) => x.from === from && x.sender !== "player" && !x.read,
          ).length;
          const count = phoneState.messages.filter((x) => x.from === from).length;
          const msgAt = msg ? Math.max(msg.at, msg.repliedAt ?? msg.at) : null;
          const callAt = call ? (call.endedAt ?? call.at) : null;
          const activityAt =
            msgAt !== null && callAt !== null
              ? Math.max(msgAt, callAt)
              : (msgAt ?? callAt ?? entry?.addedAt ?? -1);
          const alive = npc ? !deathKnown(npc) : true;
          const met = Boolean(npc?.met);
          const isFixer = Boolean(fixer);
          return {
            from,
            name: npc?.name ?? fixer?.name ?? msg?.name ?? call?.name ?? from,
            npc: met && npc ? npc.id : null,
            affinity: met && npc ? npc.affinity : null,
            alive,
            met,
            isFixer,
            canChat: Boolean(npc) && alive,
            contactSource: entry?.source ?? "inbound",
            contactNote: entry?.note ?? null,
            last:
              msgAt !== null
                ? formatGameTime(msgAt)
                : callAt !== null
                  ? formatGameTime(callAt)
                  : null,
            unread,
            count,
            _sortAt: activityAt,
            _sortId: msg?.id ?? 0,
          };
        })
        .sort(
          (a, b) =>
            Number(b.unread > 0) - Number(a.unread > 0) ||
            b._sortAt - a._sortAt ||
            b._sortId - a._sortId ||
            (a.from < b.from ? -1 : a.from > b.from ? 1 : 0),
        )
        .map(({ _sortAt: _at, _sortId: _id, ...item }) => item);
    })(),
  };
}
