import type { FeedItem, ViewContext } from "../../kernel/system";
import { NpcStateSchema } from "../npc";
import { PhoneStateSchema } from "../phone";
import { formatGameTime } from "../world";
import { arcCatalog } from "./apply";
import { ArcsStateSchema } from "./schema";

/**
 * 心事有了结果：只收场外推出、玩家已经听说了的（outcome.known）；正文里当场发生的玩家亲眼看见，不再提醒。
 * 只写他的名字和这件事的标题（他说出口时玩家就看得到）；结果原文、场外进展和原作结局都只给叙事模型
 */
export function arcsFeed({ world, data }: ViewContext): readonly FeedItem[] {
  if (world.slices.arcs === undefined) return [];
  const state = ArcsStateSchema.parse(world.slices.arcs);
  const seeds = arcCatalog(data ?? {});
  const npcs = NpcStateSchema.parse(world.slices.npc ?? {}).npcs;
  const read = new Set(PhoneStateSchema.parse(world.slices.phone ?? {}).feedRead);
  const items: FeedItem[] = [];
  for (const [npc, arc] of Object.entries(state.arcs)) {
    const seed = seeds.get(npc);
    if (!seed) continue;
    for (const concern of seed.concerns) {
      const outcome = arc.concerns[concern.id]?.outcome;
      if (outcome?.by !== "offscreen" || !outcome.known) continue;
      const id = `arcs:${npc}:${concern.id}`;
      items.push({
        id,
        source: "arcs",
        channel: "messages",
        from: npcs[npc]?.name ?? npc,
        text: `心事有了结果：${concern.title}`,
        at: outcome.at,
        time: formatGameTime(outcome.at),
        unread: !read.has(id),
        notify: true,
        attachments: [],
      });
    }
  }
  return items;
}
