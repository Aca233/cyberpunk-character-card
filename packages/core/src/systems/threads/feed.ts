import type { FeedItem, ViewContext } from "../../kernel/system";
import { PhoneStateSchema } from "../phone";
import { formatGameTime } from "../world";
import { ThreadsStateSchema } from "./schema";

/** 稳定的短哈希（双 32 位 FNV-1a），避免中文 encodeURIComponent 后撑爆 feed id 长度上限 */
function newsDigest(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ ((code + i) & 0xffff), 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(36)}-${h2.toString(36)}`;
}

/** 只发布听说过的说法，不暴露幕后主人（用户 2026-11-01 定的"全改"第 4 步） */
export function threadsFeed({ world }: ViewContext): readonly FeedItem[] {
  const state = ThreadsStateSchema.parse(world.slices.threads ?? {});
  const read = new Set(PhoneStateSchema.parse(world.slices.phone ?? {}).feedRead);
  const items = new Map<string, FeedItem>();
  for (const t of [...state.threads, ...state.closed]) {
    for (const s of t.steps) {
      if (!s.told || s.kind !== "move") continue;
      // 不用数组下标：旧步骤裁掉后，已读标记仍能对上；用定长哈希代替 encodeURIComponent(news)，同刻同文只留一条且不超 id 长度限制
      const id = `threads:${t.id}:${t.openedAt}:${s.at}:${newsDigest(s.news)}`;
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
