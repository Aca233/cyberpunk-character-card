import type { StatusContext, SystemStatus } from "../../kernel/system";
import type { phoneMessagesView } from "./messages";

/** 【当前状态】里消息的一行：最近几条，最近的在前 */

type MessagesView = ReturnType<typeof phoneMessagesView>;

const messagesOf = (ctx: StatusContext) => ctx.views.phoneMessages as MessagesView;

/** 状态里列最近几条消息 */
export const PROMPT_MESSAGES = 5;

export const phoneStatus: readonly SystemStatus[] = [
  {
    order: 80,
    lines(ctx) {
      const m = messagesOf(ctx);
      if (m.messages.length === 0) return [];
      return [
        `消息（最近的在前，未读 ${m.unread} 条）：${m.messages
          .slice(0, PROMPT_MESSAGES)
          .map((msg) => {
            if (msg.sender === "player") {
              return `#${msg.id} 你 -> ${msg.name}（${msg.at}）：${msg.text}`;
            }
            const jobNote =
              msg.job && (msg.job.status === "offered" || msg.job.status === "active")
                ? `［关联委托 ${msg.job.id}「${msg.job.title}」(${msg.job.statusLabel})］`
                : "";
            return `#${msg.id} ${msg.name}（${msg.at}${msg.read ? (msg.replied ? "，已回复" : "") : "，未读"}）${jobNote}：${msg.text}`;
          })
          .join("；")}`,
      ];
    },
  },
];
