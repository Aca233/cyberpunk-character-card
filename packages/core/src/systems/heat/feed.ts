import type { FeedItem, ViewContext } from "../../kernel/system";
import { PhoneStateSchema } from "../phone";
import { formatGameTime } from "../world";
import { HeatStateSchema } from "./schema";

/**
 * 通缉星级真的涨了才进警方频段：只写涨到几星，玩家在热度面板上本来就看得到；
 * 封顶、只攒了半星的不播。每条用独立编号，旧的滚出列表也不改变剩下的 id
 */
export function heatFeed({ world }: ViewContext): readonly FeedItem[] {
  if (world.slices.heat === undefined) return [];
  const heat = HeatStateSchema.parse(world.slices.heat);
  const read = new Set(PhoneStateSchema.parse(world.slices.phone ?? {}).feedRead);
  return heat.notices.map((n) => {
    const id = `heat:notice:${n.id}`;
    return {
      id,
      source: "heat",
      channel: "police" as const,
      from: "NCPD 调度",
      text: `通缉等级上升：${n.before} → ${n.after} 星`,
      at: n.at,
      time: formatGameTime(n.at),
      unread: !read.has(id),
      notify: true,
      attachments: [],
    };
  });
}
