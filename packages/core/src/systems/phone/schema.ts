import { z } from "zod";

/** 消息记录最多留这么多条；按会话保底后淘汰最旧 */
export const PHONE_KEPT = 80;
/** 每个会话在总容量满了之后至少保底保留几条最近往来（连同进行中委托附件） */
export const PHONE_THREAD_MIN = 8;
/** 同场景同人物私信自然收尾软上限（超过后引导转回线下正文） */
export const CHAT_SCENE_TURN_SOFT_CAP = 6;
/** 叙事模型每轮最多发几条 */
export const MESSAGES_PER_TURN = 2;

export const MessageSenderSchema = z.enum(["npc", "player"]);
export type MessageSender = z.infer<typeof MessageSenderSchema>;

export const MessageSchema = z.object({
  id: z.number().int().min(1),
  /** 人物 id、中间人 id，或者叙事模型写的名字（player 发出的也写对方频道 key，方便按会话归拢） */
  from: z.string().min(1),
  /** 显示用的名字：查得到人物卡或中间人时用中文名 */
  name: z.string().min(1),
  /** 消息发起方：npc 对方发来，player 玩家发去；旧存档没写按 npc */
  sender: MessageSenderSchema.default("npc"),
  text: z.string().min(1).max(300),
  /** 委托卡附件：收件时校验委托仍可接，展示和接单时再次检查当前状态 */
  job: z.string().min(1).optional(),
  at: z.number().int(),
  read: z.boolean(),
  replied: z.boolean(),
  /** 玩家回的那句（这一轮的输入原文，截到 300 字）；旧存档和没记下的是 undefined */
  reply: z.string().min(1).max(300).optional(),
  /** 回复时的游戏时间 */
  repliedAt: z.number().int().optional(),
});
export type Message = z.infer<typeof MessageSchema>;

/** 全息电话响多久没接算没接（游戏分钟）；通话记录最多留几条 */
export const CALL_RING_MINUTES = 5;
export const CALLS_KEPT = 20;

export const CallStatusSchema = z.enum(["ringing", "answered", "declined", "missed"]);
export type CallStatus = z.infer<typeof CallStatusSchema>;
export const CALL_STATUS_LABELS: Readonly<Record<CallStatus, string>> = {
  ringing: "来电",
  answered: "接了",
  declined: "拒接",
  missed: "全息电话没接！",
};

/** 一通全息电话：打来想说什么只给叙事模型看，接起来才写进正文 */
export const CallSchema = z.object({
  id: z.number().int().min(1),
  from: z.string().min(1),
  name: z.string().min(1),
  /** 打来的用意；只进情境节，不进玩家投影 */
  about: z.string().min(1).max(200),
  at: z.number().int(),
  status: CallStatusSchema,
  endedAt: z.number().int().nullable().default(null),
});
export type Call = z.infer<typeof CallSchema>;

export const ChatSceneBudgetSchema = z.object({
  scene: z.number().int().min(0),
  turns: z.number().int().min(0).default(0),
  jobOffered: z.boolean().default(false),
  /** 本场该联系人已通过私信挂出的委托数量（支持中间人一次拿出多单供挑选） */
  jobsOffered: z.number().int().min(0).default(0),
});
export type ChatSceneBudget = z.infer<typeof ChatSceneBudgetSchema>;

/** 通讯录来源：开局旧识 / 剧情交换联系方式 / 对方来信来电入录 / 旧存档迁移 */
export const ContactSourceSchema = z.enum(["opening", "exchange", "inbound", "legacy"]);
export type ContactSource = z.infer<typeof ContactSourceSchema>;

export const ContactEntrySchema = z.object({
  addedAt: z.number().int(),
  source: ContactSourceSchema,
  note: z.string().trim().min(1).max(80).optional(),
});
export type ContactEntry = z.infer<typeof ContactEntrySchema>;

export const PhoneStateSchema = z.object({
  messages: z.array(MessageSchema).max(PHONE_KEPT).default([]),
  nextId: z.number().int().min(1).default(1),
  calls: z.array(CallSchema).max(CALLS_KEPT).default([]),
  nextCall: z.number().int().min(1).default(1),
  /** 其他系统交来的公开消息的已读 id；人物消息仍以 messages[].read 为准 */
  feedRead: z.array(z.string().min(1)).default([]),
  /** 手机直聊每个人物在当前场景下的次数/好感/派单配额；旧存档没有 */
  chatBudget: z.record(z.string(), ChatSceneBudgetSchema).default({}),
  /** 已建立全息联络渠道的通讯录（键为人物 id 或中间人 id）；旧存档没有 */
  contacts: z.record(z.string(), ContactEntrySchema).default({}),
});
export type PhoneState = z.infer<typeof PhoneStateSchema>;

/** 模型在正文明确交换联系方式、留名片或拉黑删号时发出 */
export const PhoneContactSchema = z
  .object({
    type: z.literal("phoneContact"),
    id: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .describe("对方的人物 id 或中间人 id（必须已有卡或是已登记中间人）"),
    action: z
      .enum(["add", "remove"])
      .default("add")
      .describe("add 交换/记下联系方式入录，remove 明确拉黑或删除联系频道"),
    note: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .optional()
      .describe("可省：留号方式或备注，例如“留了私人频道”“中间人转线”"),
  })
  .describe(
    "通讯录变更：仅正文明确发生交换全息号、留联系方式/名片或拉黑删号时发出；单纯见面或听说不发",
  );
export type PhoneContactCommand = z.infer<typeof PhoneContactSchema>;

/** 只能由代码发出：开局旧识等初始化写入通讯录 */
export const SeedContactSchema = z.object({
  type: z.literal("phone.seedContact"),
  id: z.string().trim().min(1).max(40),
  source: ContactSourceSchema.default("opening"),
  note: z.string().trim().min(1).max(80).optional(),
});
export type SeedContactCommand = z.infer<typeof SeedContactSchema>;

/** 抽取结果顶层的一条 messages */
export const IncomingMessageSchema = z.object({
  from: z.string().trim().min(1).max(40).describe("发消息的人：人物 id、中间人 id，或者一个名字"),
  text: z.string().trim().min(1).max(300).describe("消息原文：短、口语，像真的短信"),
  job: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("派单消息附带的委托 id；必须是已经挂出且仍可接的委托，普通消息不写"),
});
export type IncomingMessage = z.infer<typeof IncomingMessageSchema>;

/** 只能由代码发出：回合流程把抽取结果里的 messages 记进消息记录 */
export const ReceiveSchema = z.object({
  type: z.literal("phone.receive"),
  from: z.string().min(1),
  text: z.string().min(1).max(300),
  /** 可选的委托卡附件，收件时由 phone 系统检查委托是否仍可接 */
  job: z.string().min(1).optional(),
});
/** 只能由代码发出：玩家在界面上看了消息 */
export const ReadSchema = z.object({
  type: z.literal("phone.read"),
  /** 本次实际展示的其他频道消息 id */
  feed: z.array(z.string().min(1).max(200)).max(200).optional(),
});
/** 只能由代码发出：这一轮的输入是在回复第 id 条 */
export const ReplySchema = z.object({
  type: z.literal("phone.reply"),
  id: z.number().int().min(1),
  /** 玩家回的那句；旧记录没有 */
  text: z.string().min(1).max(300).optional(),
});

/** 只能由代码发出：重要的人打来全息电话；about 是打来的用意，只给叙事模型看 */
export const CallCommandSchema = z.object({
  type: z.literal("phone.call"),
  from: z.string().min(1),
  about: z.string().trim().min(1).max(200),
});
/** 只能由代码发出：玩家在界面上接起或拒接正在响的那通 */
export const AnswerSchema = z.object({
  type: z.literal("phone.answer"),
  id: z.number().int().min(1),
  answer: z.boolean(),
});

/** 只能由代码发出：手机私聊窗口玩家发出一条短讯 */
export const SendSchema = z.object({
  type: z.literal("phone.send"),
  to: z.string().min(1),
  text: z.string().trim().min(1).max(300),
});
export type SendCommand = z.infer<typeof SendSchema>;

/** 只能由代码发出：记录当前场景同人物私聊次数与是否已派单 */
export const ChatMetaSchema = z.object({
  type: z.literal("phone.chatMeta"),
  npc: z.string().min(1),
  scene: z.number().int().min(0),
  jobOffered: z.boolean().optional(),
});
export type ChatMeta = z.infer<typeof ChatMetaSchema>;

export type PhoneCommand = PhoneContactCommand;

export type PhoneInternal =
  | z.infer<typeof ReceiveSchema>
  | z.infer<typeof ReadSchema>
  | z.infer<typeof ReplySchema>
  | z.infer<typeof CallCommandSchema>
  | z.infer<typeof AnswerSchema>
  | SendCommand
  | ChatMeta
  | SeedContactCommand;

/** 检查某个频道/人物是否已建立全息联系渠道（显式入录或已有消息/来电往来） */
export function hasContactChannel(phone: PhoneState, id: string): boolean {
  if (phone.contacts[id] !== undefined) return true;
  if (phone.messages.some((m) => m.from === id)) return true;
  if (phone.calls.some((c) => c.from === id)) return true;
  return false;
}
