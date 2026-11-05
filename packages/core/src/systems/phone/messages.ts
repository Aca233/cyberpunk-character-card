import type { FeedItem, ViewContext } from "../../kernel/system";
import { deathKnown, NpcStateSchema } from "../npc";
import { formatGameTime } from "../world";
import { PhoneStateSchema } from "./schema";

/** 界面上最多列几条消息 */
const PHONE_SHOWN = 20;

/** 各频道未读消息的 id；打开频道后交回 readMessages 标已读 */
export function phoneFeedUnread(feed: readonly FeedItem[]) {
  return {
    messages: feed.filter((i) => i.unread && i.channel === "messages").map((i) => i.id),
    news: feed.filter((i) => i.unread && i.channel === "news").map((i) => i.id),
    police: feed.filter((i) => i.unread && i.channel === "police").map((i) => i.id),
    street: feed.filter((i) => i.unread && i.channel === "street").map((i) => i.id),
  };
}

/** 消息和联系人；只展示玩家知道的生死，不暴露场外死亡 */
export function phoneMessagesView({ world }: ViewContext) {
  const phoneState = PhoneStateSchema.parse(world.slices.phone ?? {});
  const npcs = NpcStateSchema.parse(world.slices.npc);
  return {
    unread: phoneState.messages.filter((m) => !m.read).length,
    messages: [...phoneState.messages]
      .reverse()
      .slice(0, PHONE_SHOWN)
      .map((m) => ({
        id: m.id,
        from: m.from,
        name: m.name,
        text: m.text,
        at: formatGameTime(m.at),
        atMinutes: m.at,
        read: m.read,
        replied: m.replied,
        reply: m.reply ?? null,
        repliedAt: m.repliedAt === undefined ? null : formatGameTime(m.repliedAt),
      })),
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
            unread: phoneState.messages.filter((x) => x.from === m.from && !x.read).length,
            count: phoneState.messages.filter((x) => x.from === m.from).length,
          };
        });
    })(),
  };
}
