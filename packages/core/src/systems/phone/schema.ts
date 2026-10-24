import { z } from "zod";

/** 消息记录最多留这么多条，旧的先删 */
export const PHONE_KEPT = 40;
/** 叙事模型每轮最多发几条 */
export const MESSAGES_PER_TURN = 2;

export const MessageSchema = z.object({
  id: z.number().int().min(1),
  /** 人物 id、中间人 id，或者叙事模型写的名字 */
  from: z.string().min(1),
  /** 显示用的名字：查得到人物卡或中间人时用中文名 */
  name: z.string().min(1),
  text: z.string().min(1).max(300),
  at: z.number().int(),
  read: z.boolean(),
  replied: z.boolean(),
});
export type Message = z.infer<typeof MessageSchema>;

export const PhoneStateSchema = z.object({
  messages: z.array(MessageSchema).max(PHONE_KEPT).default([]),
  nextId: z.number().int().min(1).default(1),
});
export type PhoneState = z.infer<typeof PhoneStateSchema>;

/** 模型在指令块顶层写的一条 messages */
export const IncomingMessageSchema = z.object({
  from: z.string().trim().min(1).max(40).describe("发消息的人：人物 id、中间人 id，或者一个名字"),
  text: z.string().trim().min(1).max(300).describe("消息原文：短、口语，像真的短信"),
});
export type IncomingMessage = z.infer<typeof IncomingMessageSchema>;

/** 只能由代码发出：回合流程把指令块里的 messages 记进消息记录 */
export const ReceiveSchema = z.object({
  type: z.literal("phone.receive"),
  from: z.string().min(1),
  text: z.string().min(1).max(300),
});
/** 只能由代码发出：玩家在界面上看了消息 */
export const ReadSchema = z.object({ type: z.literal("phone.read") });
/** 只能由代码发出：这一轮的输入是在回复第 id 条 */
export const ReplySchema = z.object({
  type: z.literal("phone.reply"),
  id: z.number().int().min(1),
});

export type PhoneInternal =
  | z.infer<typeof ReceiveSchema>
  | z.infer<typeof ReadSchema>
  | z.infer<typeof ReplySchema>;
