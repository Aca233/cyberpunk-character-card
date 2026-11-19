import { z } from "zod";

export const SHARD_TITLE_CHARS = 80;
export const SHARD_FROM_CHARS = 120;
/** 每次提交一段；完整资料分段保存，不截断或淘汰较早原文。 */
export const SHARD_PART_CHARS = 16_000;
export const SHARDS_READ_BATCH = 200;

export const ShardKindSchema = z.enum(["recording", "email", "diary", "data"]);
export type ShardKind = z.infer<typeof ShardKindSchema>;
export const SHARD_KIND_LABELS: Readonly<Record<ShardKind, string>> = {
  recording: "录音",
  email: "邮件",
  diary: "日记",
  data: "资料",
};

export const ChipPartSchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(80),
  text: z.string().min(1).max(SHARD_PART_CHARS),
  protectionNetwork: z.string().min(1).max(30).optional(),
});
export const ChipContentSchema = z
  .object({
    id: z.string().min(1).max(80),
    title: z.string().min(1).max(SHARD_TITLE_CHARS),
    kind: ShardKindSchema,
    from: z.string().min(1).max(SHARD_FROM_CHARS).nullable().default(null),
    purpose: z.enum(["data", "media", "function", "behavior"]),
    summary: z.string().min(1).max(600),
    parts: z.array(ChipPartSchema).default([]),
    requirements: z.array(z.string().min(1)).default([]),
    ability: z.string().min(1).max(1200).optional(),
    braindance: z.string().min(1).optional(),
    related: z.array(z.string().min(1)).default([]),
  })
  .superRefine((content, ctx) => {
    if (new Set(content.parts.map((part) => part.id)).size !== content.parts.length)
      ctx.addIssue({ code: "custom", message: "内容分段 id 不能重复" });
  });
export type ChipContent = z.infer<typeof ChipContentSchema>;

/** 角色已经亲自读到的原文；read 只表示玩家是否打开过界面。 */
export const ShardSchema = z.object({
  id: z.number().int().positive(),
  contentId: z.string().min(1),
  partId: z.string().min(1),
  carrier: z.string().nullable(),
  kind: ShardKindSchema,
  title: z.string().min(1).max(SHARD_TITLE_CHARS),
  from: z.string().min(1).max(SHARD_FROM_CHARS).nullable(),
  text: z.string().min(1),
  at: z.number().int(),
  location: z.string().nullable(),
  related: z.array(z.string()).default([]),
  read: z.boolean(),
});
export type Shard = z.infer<typeof ShardSchema>;

export const ShardsStateSchema = z.object({
  shards: z.array(ShardSchema).default([]),
  nextShard: z.number().int().positive().default(1),
  contents: z.record(z.string(), ChipContentSchema).default({}),
  /** 实际解开的分段；黑客网络历史归档后也不重新上锁。 */
  unlocked: z.record(z.string(), z.array(z.string())).default({}),
});
export type ShardsState = z.infer<typeof ShardsStateSchema>;

export const ShardCommandSchema = z
  .object({
    type: z.literal("shard"),
    contentId: z.string().min(1).max(80).describe("稳定内容 id；重读不变，同名不同资料分开"),
    partId: z.string().min(1).max(80).describe("实际读到的固定段落 id，后续部分另用 partId"),
    carrier: z
      .string()
      .min(1)
      .optional()
      .describe("来自实物芯片时写真实载体 id；固定芯片内容优先用 chip read"),
    kind: ShardKindSchema,
    title: z.string().trim().min(1).max(SHARD_TITLE_CHARS),
    from: z.string().trim().min(1).max(SHARD_FROM_CHARS).optional(),
    text: z
      .string()
      .trim()
      .min(1)
      .max(SHARD_PART_CHARS)
      .describe("角色已经实际读到的原文；不能覆盖定稿或录入未解开部分"),
    related: z
      .array(z.string().min(1))
      .max(20)
      .default([])
      .describe("实际关联的人物、地点、作品 id，用于以后召回"),
  })
  .describe("角色实际阅读的邮件、日记、录音和新资料；取得载体或打开旧档案不发此指令。");
export type ShardCommand = z.infer<typeof ShardCommandSchema>;

export const ChipCommandSchema = z.discriminatedUnion("action", [
  z.object({
    type: z.literal("chip"),
    action: z.literal("define"),
    carrier: z.string().min(1),
    device: z
      .string()
      .min(1)
      .optional()
      .describe("确实向空白载体写入新内容时填写实际读写器；已有来源的完整载体登记不需重写"),
    content: ChipContentSchema,
    evidence: z
      .string()
      .min(2)
      .max(500)
      .describe("本轮正文确立载体与资料来源的原话；资料定稿后不能覆盖"),
  }),
  z.object({
    type: z.literal("chip"),
    action: z.literal("read"),
    carrier: z.string().min(1),
    device: z.string().min(1),
    parts: z
      .array(z.string().min(1))
      .min(1)
      .max(40)
      .describe("本次实际读到的分段 id，不能把所有未读和加密内容自动读完"),
  }),
  z.object({
    type: z.literal("chip"),
    action: z.literal("unlock"),
    carrier: z.string().min(1),
    parts: z.array(z.string().min(1)).min(1).max(40),
    network: z.string().min(1).max(30).describe("实际 breach 成功并取得 data 的芯片保护网络"),
  }),
  z.object({
    type: z.literal("chip"),
    action: z.literal("copy"),
    carrier: z.string().min(1),
    destination: z.string().min(1),
    device: z.string().min(1),
    reason: z.string().min(1).max(240),
  }),
  z.object({
    type: z.literal("chip"),
    action: z.literal("use"),
    carrier: z.string().min(1),
    reason: z.string().min(1).max(240).describe("本次功能辅助的实际用途，不代表永久掌握技能"),
  }),
]);
export type ChipCommand = z.infer<typeof ChipCommandSchema>;

export const ShardReadSchema = z.object({
  type: z.literal("shards.read"),
  ids: z.array(z.number().int().positive()).max(SHARDS_READ_BATCH),
});
export type ShardRead = z.infer<typeof ShardReadSchema>;
export type ShardsInternal = ShardRead;
