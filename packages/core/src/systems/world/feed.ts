import { z } from "zod";
import type { FeedItem, ViewContext } from "../../kernel/system";
import { CanonTimelineSchema } from "../../schemas/lore";
import { formatGameTime } from "./apply";
import { WorldClockStateSchema } from "./schema";

/** 离期限还剩这么多分钟时，神经界面自己弹一条提醒 */
export const DEADLINE_WARN_MINUTES = 180;
const DAY_MINUTES = 24 * 60;

/**
 * phone 依赖 world，这里不能反过来引用 phone 的入口，否则成环；
 * 只读已读列表这一项，和 phone 的 feedRead 同形
 */
const FeedReadSchema = z.object({ feedRead: z.array(z.string()).default([]) });

/**
 * 期限快到了：到了提醒时刻（期限前 DEADLINE_WARN_MINUTES 分钟）、那时还没了结的期限，进消息频道，
 * 发送人是神经界面自己。2077 世界时间线到达节点后，将对应的公开快讯推入 N54 新闻频道（与 canon.ts 统一按开场后天数算）。
 */
export function worldFeed({ world, data }: ViewContext): readonly FeedItem[] {
  if (world.slices.world === undefined) return [];
  const clock = WorldClockStateSchema.parse(world.slices.world);
  const read = new Set(FeedReadSchema.parse(world.slices.phone ?? {}).feedRead);
  const deadlineItems: FeedItem[] = clock.deadlines
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

  const newsItems: FeedItem[] = [];
  const origin = clock.startedAt;
  if (origin !== undefined && data.canon !== undefined) {
    const parsed = CanonTimelineSchema.safeParse(data.canon);
    if (parsed.success) {
      const elapsedDay = Math.floor((world.time - origin) / DAY_MINUTES);
      for (const node of parsed.data) {
        if (elapsedDay < node.fromDay) continue;
        const at = origin + node.fromDay * DAY_MINUTES;
        if (world.time < at) continue;
        const id = `world:canon:${node.id}`;
        newsItems.push({
          id,
          source: "world",
          channel: "news",
          from: "N54 新闻",
          text: `【N54 快讯 · ${node.title}】${node.public}`,
          at,
          time: formatGameTime(at),
          unread: !read.has(id),
          notify: false,
          attachments: [],
        });
      }
    }
  }

  return [...deadlineItems, ...newsItems];
}
