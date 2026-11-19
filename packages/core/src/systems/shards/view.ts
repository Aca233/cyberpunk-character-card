import type { ViewContext } from "../../kernel/system";
import { formatGameTime } from "../world";
import { SHARD_KIND_LABELS, ShardsStateSchema } from "./schema";

/** 数据库页的芯片：原文就是玩家读到的，逐项取值，新读到的在前 */
export function shardsView({ world }: ViewContext) {
  const state = ShardsStateSchema.parse(world.slices.shards ?? {});
  const list = [...state.shards].reverse().map((s) => ({
    id: s.id,
    contentId: s.contentId,
    partId: s.partId,
    carrier: s.carrier,
    kind: s.kind,
    kindLabel: SHARD_KIND_LABELS[s.kind],
    title: s.title,
    from: s.from,
    text: s.text,
    media: s.media ?? [],
    at: formatGameTime(s.at),
    read: s.read,
  }));
  return { list, unread: list.filter((s) => !s.read).length };
}
