import type { FeedItem, ViewContext } from "../../kernel/system";
import { PhoneStateSchema } from "../phone";
import { formatGameTime, locationCatalog } from "../world";
import { NcpdStateSchema } from "./schema";

/**
 * 扫描器上还挂着的警情进警方频段，附上出事的地点；
 * 警方频段只有通缉升级才弹提醒（热度系统交），警情只加未读数
 */
export function ncpdFeed({ world, data }: ViewContext): readonly FeedItem[] {
  const state = NcpdStateSchema.parse(world.slices.ncpd ?? {});
  const read = new Set(PhoneStateSchema.parse(world.slices.phone ?? {}).feedRead);
  const places = locationCatalog(data);
  return state.alerts
    .filter((a) => a.expiresAt > world.time)
    .map((a) => {
      const id = `ncpd:${a.id}`;
      const place = places.get(a.location);
      return {
        id,
        source: "ncpd",
        channel: "police" as const,
        from: "NCPD 扫描器",
        text: `${a.label}（${a.district}）：${a.note}`,
        at: a.postedAt,
        time: formatGameTime(a.postedAt),
        unread: !read.has(id),
        notify: false,
        attachments: place
          ? [{ kind: "location" as const, id: a.location, label: place.name }]
          : [],
      };
    });
}
