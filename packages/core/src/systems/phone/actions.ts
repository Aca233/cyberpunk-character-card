import { z } from "zod";
import { defineAction } from "../../kernel/system";

/** 打开消息：把消息都标成已读 */
export const ReadMessagesActionSchema = z.strictObject({ type: z.literal("readMessages") });

/** 消息面板的操作：只翻成指令，统一由操作入口结算 */
export const phoneActions = {
  readMessages: defineAction({
    schema: ReadMessagesActionSchema,
    commands: () => [{ type: "phone.read" }],
  }),
};
