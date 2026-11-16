import type { FeedAttachment, FeedItem, ViewContext } from "../../kernel/system";
import { JobsStateSchema } from "../jobs";
import { formatGameTime } from "../world";
import { CALL_STATUS_LABELS, PhoneStateSchema } from "./schema";

/** 已经收到的人物消息；已读状态沿用收件箱，不因重新投影变回未读 */
export function phoneFeed({ world }: ViewContext): readonly FeedItem[] {
  const state = PhoneStateSchema.parse(world.slices.phone ?? {});
  const jobs = new Map(JobsStateSchema.parse(world.slices.jobs).jobs.map((job) => [job.id, job]));
  const attachments = (id: string | undefined): FeedAttachment[] => {
    const job = id === undefined ? undefined : jobs.get(id);
    if (job?.status !== "offered" || (job.due !== null && job.due <= world.time)) return [];
    return [{ kind: "job", id: job.id, label: job.title }];
  };
  const read = new Set(state.feedRead);
  const messages: FeedItem[] = state.messages
    .filter((message) => message.sender !== "player")
    .map((message) => ({
      id: `phone:message:${message.id}`,
      source: "phone",
      channel: "messages",
      from: message.name,
      text: message.text,
      at: message.at,
      time: formatGameTime(message.at),
      unread: !message.read,
      notify: true,
      attachments: attachments(message.job),
    }));
  // 没接的全息电话记一条；打来的用意只给叙事模型看，这里只写原作那句提示
  const missed: FeedItem[] = state.calls
    .filter((call) => call.status === "missed")
    .map((call) => {
      const id = `phone:call:${call.id}`;
      const at = call.endedAt ?? call.at;
      return {
        id,
        source: "phone",
        channel: "messages",
        from: call.name,
        text: CALL_STATUS_LABELS.missed,
        at,
        time: formatGameTime(at),
        unread: !read.has(id),
        notify: true,
        attachments: [],
      };
    });
  return [...messages, ...missed];
}
