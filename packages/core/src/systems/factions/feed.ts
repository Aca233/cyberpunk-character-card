import type { FeedItem, ViewContext } from "../../kernel/system";
import { PhoneStateSchema } from "../phone";
import { formatGameTime } from "../world";
import { agendaCatalog, progressOf } from "./agenda";
import { factionCatalog } from "./apply";
import { FactionsStateSchema } from "./schema";

/**
 * 玩家听说了的势力动向进新闻频道：只用传开的那一句和听说了的地盘变化；
 * 幕后经过、改结果的理由和后续钩子不进来，玩家自己插手的几步也不算街头消息
 */
export function factionsFeed({ world, data }: ViewContext): readonly FeedItem[] {
  const state = FactionsStateSchema.parse(world.slices.factions ?? {});
  const catalog = factionCatalog(data);
  const read = new Set(PhoneStateSchema.parse(world.slices.phone ?? {}).feedRead);
  const name = (id: string) => catalog.get(id)?.name ?? id;
  return [...agendaCatalog(data).values()].flatMap((seed) =>
    progressOf(state, seed.id)
      .moves.filter((m) => m.told && m.kind === "move")
      .map((m) => {
        const id = `factions:${seed.id}:${m.at}`;
        const turf = m.turf
          ? `（${name(m.turf.faction)}${m.turf.change === "gain" ? "拿下了" : "丢了"}${m.turf.district}）`
          : "";
        return {
          id,
          source: "factions",
          channel: "news" as const,
          from: name(seed.faction),
          text: `${m.news}${turf}`,
          at: m.at,
          time: formatGameTime(m.at),
          unread: !read.has(id),
          notify: false,
          attachments: [],
        };
      }),
  );
}
