import { z } from "zod";
import { defineAction } from "../../kernel/system";

/** 打开消息：人物消息标已读；feed 只提交本次实际展示的其他频道消息 id */
export const ReadMessagesActionSchema = z.strictObject({
  type: z.literal("readMessages"),
  feed: z.array(z.string().min(1).max(200)).max(200).optional(),
});

/** 全息电话来电：接起或拒接正在响的那通；不调用模型，接起后下一轮正文接着写通话 */
export const AnswerCallActionSchema = z.strictObject({
  type: z.literal("answerCall"),
  id: z.number().int().min(1),
  answer: z.boolean(),
});

/** 消息面板的操作：只翻成指令，统一由操作入口结算 */
export const phoneActions = {
  answerCall: defineAction({
    schema: AnswerCallActionSchema,
    commands: (action) => [{ type: "phone.answer", id: action.id, answer: action.answer }],
  }),
  readMessages: defineAction({
    schema: ReadMessagesActionSchema,
    commands: (action) => [
      {
        type: "phone.read",
        ...(action.feed === undefined ? {} : { feed: action.feed }),
      },
    ],
  }),
};
