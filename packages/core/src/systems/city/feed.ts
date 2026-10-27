import type { FeedItem, ViewContext } from "../../kernel/system";
import { PhoneStateSchema } from "../phone";
import { formatGameTime } from "../world";
import { BULLETIN_KIND_LABELS, CityStateSchema } from "./schema";

/**
 * 公开播报进新闻频道，玩家听说了的传闻进街头频道：只用播出和传到耳朵里的原话，
 * 不带场外事件、传闻和真相差多少、说的是哪条动静；已读记在消息记录里
 */
export function cityFeed({ world }: ViewContext): readonly FeedItem[] {
  const city = CityStateSchema.parse(world.slices.city ?? {});
  const read = new Set(PhoneStateSchema.parse(world.slices.phone ?? {}).feedRead);
  const news = city.bulletins.map((b) => {
    const id = `city:bulletin:${b.id}`;
    return {
      id,
      source: "city",
      channel: "news" as const,
      from: BULLETIN_KIND_LABELS[b.kind],
      text: `${b.title}：${b.text}`,
      at: b.at,
      time: formatGameTime(b.at),
      unread: !read.has(id),
      notify: false,
      attachments: [],
    };
  });
  const street = city.rumors
    .filter((r) => r.heard && r.id > 0)
    .map((r) => {
      const id = `city:rumor:${r.id}`;
      return {
        id,
        source: "city",
        channel: "street" as const,
        from: "街头传闻",
        text: r.text,
        at: r.at,
        time: formatGameTime(r.at),
        unread: !read.has(id),
        notify: false,
        attachments: [],
      };
    });
  return [...news, ...street];
}
