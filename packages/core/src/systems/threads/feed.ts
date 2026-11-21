import type { FeedItem, ViewContext } from "../../kernel/system";
import { PhoneStateSchema } from "../phone";
import { formatGameTime } from "../world";
import { ThreadsStateSchema } from "./schema";

/** 只发布听说过的说法，不暴露幕后主人（用户 2026-11-01 定的"全改"第 4 步） */
export function threadsFeed({ world }: ViewContext): readonly FeedItem[] {
  const state = ThreadsStateSchema.parse(world.slices.threads ?? {});
  const read = new Set(PhoneStateSchema.parse(world.slices.phone ?? {}).feedRead);
  const items = new Map<string, FeedItem>();
  for (const t of [...state.threads, ...state.closed]) {
    for (const s of t.steps) {
      if (!s.told || s.kind !== "move") continue;
      // 不用数组下标：旧步骤裁掉后，已读标记仍能对上；同刻同文只留一条
      const id = `threads:${t.id}:${t.openedAt}:${s.at}:${encodeURIComponent(s.news)}`;
      const isFaction = t.kind === "faction";
      items.set(id, {
        id,
        source: "threads",
        channel: isFaction ? "news" : "street",
        from: isFaction ? "新闻" : "街头",
        text: s.news,
        at: s.at,
        time: formatGameTime(s.at),
        unread: !read.has(id),
        notify: false,
        attachments: [],
      });
    }
  }
  return [...items.values()];
}
