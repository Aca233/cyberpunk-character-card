import { z } from "zod";
import type { FeedItem, ViewContext } from "../../kernel/system";
import { formatGameTime } from "./apply";
import { WorldClockStateSchema } from "./schema";

/** 离期限还剩这么多分钟时，神经界面自己弹一条提醒 */
export const DEADLINE_WARN_MINUTES = 180;

/**
 * phone 依赖 world，这里不能反过来引用 phone 的入口，否则成环；
 * 只读已读列表这一项，和 phone 的 feedRead 同形
 */
const FeedReadSchema = z.object({ feedRead: z.array(z.string()).default([]) });

/**
 * 期限快到了：到了提醒时刻（期限前 DEADLINE_WARN_MINUTES 分钟）、那时还没了结的期限，进消息频道，
 * 发送人是神经界面自己。2077 静态时间线不再直接推送给玩家新闻频道，统一交由场外演化按本局真实事实播报。
 */
export function worldFeed({ world }: ViewContext): readonly FeedItem[] {
  if (world.slices.world === undefined) return [];
  const clock = WorldClockStateSchema.parse(world.slices.world);
  const read = new Set(FeedReadSchema.parse(world.slices.phone ?? {}).feedRead);
  return clock.deadlines
    .filter((d) => {
      const warnAt = d.due - DEADLINE_WARN_MINUTES;
      return world.time >= warnAt && (d.handledAt === null || d.handledAt > warnAt);
    })
    .map((d) => {
      const id = `world:deadline:${d.id}`;
      const at = d.due - DEADLINE_WARN_MINUTES;
      return {
        id,
        source: "world",
        channel: "messages" as const,
        from: "神经界面",
        text: `期限将至：${d.label}（${formatGameTime(d.due)} 前）`,
        at,
        time: formatGameTime(at),
        unread: !read.has(id),
        notify: true,
        attachments: [],
      };
    });
}
