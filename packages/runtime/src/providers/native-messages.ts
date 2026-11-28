import type { LlmMessage } from "@cp/core";
import { UpstreamError } from "./http";

/** 原生协议只支持顶层 system；不能通过挪位置或改 role 冒充支持历史内的 system 注入。 */
export function assertNativeSystemPrefix(messages: readonly LlmMessage[], protocol: string): void {
  let inConversation = false;
  for (const [index, message] of messages.entries()) {
    if (message.role !== "system") {
      inConversation = true;
    } else if (inConversation) {
      throw new UpstreamError(
        `${protocol} 原生接口不支持对话历史中的 system 消息（第 ${index + 1} 条）。请改用支持原始消息序列的 OpenAI 兼容连接，或调整预设/世界书深度条目的 role；不会自动移动消息或更改角色。`,
      );
    }
  }
}
