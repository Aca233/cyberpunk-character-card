import type { FeedItem, ViewContext } from "../../kernel/system";
import { PhoneStateSchema } from "../phone";
import { formatGameTime } from "../world";
import { NemesisStateSchema } from "./schema";

/**
 * 宿敌在屏幕外动了一步：神经界面只提示「他又有动静了」，进消息频道。
 * 他具体做了什么、准备了什么只给叙事模型，这里一个字都不带；动作按时间编号，旧的滚出列表也不改 id
 */
export function nemesisFeed({ world }: ViewContext): readonly FeedItem[] {
  if (world.slices.nemesis === undefined) return [];
  const state = NemesisStateSchema.parse(world.slices.nemesis);
  const read = new Set(PhoneStateSchema.parse(world.slices.phone ?? {}).feedRead);
  return state.nemeses.flatMap((rival) =>
    rival.moves.map((move) => {
      const id = `nemesis:${rival.npc}:${move.at}`;
      return {
        id,
        source: "nemesis",
        channel: "messages" as const,
        from: "神经界面",
        text: `宿敌动向：${rival.name}又有动静了`,
        at: move.at,
        time: formatGameTime(move.at),
        unread: !read.has(id),
        notify: true,
        attachments: [],
      };
    }),
  );
}
