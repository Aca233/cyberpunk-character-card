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
  const jobs = new Map(JobsStateSchema.parse(world.slices.jobs).jobs.map((j) => [j.id, j]));
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
    /** 联系人：按最后一条消息排，新的在前；有人物卡的带好感和玩家知道的死活 */
    contacts: (() => {
      const latest = new Map<string, (typeof phoneState.messages)[number]>();
      for (const m of phoneState.messages) latest.set(m.from, m);
      return [...latest.values()]
        .sort((a, b) => b.at - a.at || b.id - a.id)
        .map((m) => {
          const npc = npcs.npcs[m.from];
          return {
            from: m.from,
            name: m.name,
            npc: npc?.met ? npc.id : null,
            affinity: npc?.met ? npc.affinity : null,
            alive: npc ? !deathKnown(npc) : true,
            last: formatGameTime(Math.max(m.at, m.repliedAt ?? m.at)),
            unread: phoneState.messages.filter(
              (x) => x.from === m.from && x.sender !== "player" && !x.read,
            ).length,
            count: phoneState.messages.filter((x) => x.from === m.from).length,
          };
        });
    })(),
  };
}
