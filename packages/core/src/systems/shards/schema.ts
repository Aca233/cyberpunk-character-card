import { z } from "zod";
import { ContentMediaListSchema } from "../../schemas/content-media";

export const SHARD_TITLE_CHARS = 80;
export const SHARD_FROM_CHARS = 120;
/** 每次提交一段；完整资料分段保存，不截断或淘汰较早原文。 */
export const SHARD_PART_CHARS = 16_000;
export const SHARDS_READ_BATCH = 200;
/** 个人颈后神经芯片槽上限：物理硬上限，不靠数值叠buff */
export const NEURAL_CHIP_SLOTS = 2;

export const ChipCategorySchema = z.enum(["intel", "daemon", "skill", "braindance", "behavior"]);
export type ChipCategory = z.infer<typeof ChipCategorySchema>;
export const CHIP_CATEGORY_LABELS: Readonly<Record<ChipCategory, string>> = {
  intel: "情报资料",
  daemon: "加密魔偶",
  skill: "技能协议",
  braindance: "超梦卷轴",
  behavior: "行为协议",
};

export const ChipEncryptionSchema = z.enum(["none", "standard", "corp", "military"]);
export type ChipEncryption = z.infer<typeof ChipEncryptionSchema>;
export const CHIP_ENCRYPTION_LABELS: Readonly<Record<ChipEncryption, string>> = {
  none: "未加密",
  standard: "常规加密",
  corp: "公司级加密",
  military: "军用级加密",
};

export const ChipHazardSchema = z.enum(["none", "malware", "black-ice"]);
export type ChipHazard = z.infer<typeof ChipHazardSchema>;
export const CHIP_HAZARD_LABELS: Readonly<Record<ChipHazard, string>> = {
  none: "安全",
  malware: "恶意病毒",
  "black-ice": "黑冰陷阱",
};

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
  media: ContentMediaListSchema.optional(),
  encrypted: z.boolean().default(false),
});
export type ChipPart = z.infer<typeof ChipPartSchema>;

export const ChipContentSchema = z
  .object({
    id: z.string().min(1).max(80),
    title: z.string().min(1).max(SHARD_TITLE_CHARS),
    category: ChipCategorySchema,
    kind: ShardKindSchema.default("data"),
    from: z.string().min(1).max(SHARD_FROM_CHARS).nullable().default(null),
    summary: z.string().min(1).max(600),
    parts: z.array(ChipPartSchema).default([]),
    encryption: ChipEncryptionSchema.default("none"),
    hazard: ChipHazardSchema.default("none"),
    /** 加密信用芯片内含欧元；破译并提取后仅结算一次，不可复制 */
    eddies: z.number().int().min(0).default(0),
    /** skill / behavior 芯片插入个人神经槽时提供的客观定性能力描述 */
    ability: z.string().min(1).max(1200).optional(),
    /** behavior 芯片对应的改装协议名称 */
    protocol: z.string().min(1).max(120).optional(),
    /** braindance 载体关联的超梦作品 id */
    braindance: z.string().min(1).optional(),
    related: z.array(z.string().min(1)).default([]),
  })
  .superRefine((content, ctx) => {
    if (new Set(content.parts.map((part) => part.id)).size !== content.parts.length)
      ctx.addIssue({ code: "custom", message: "内容分段 id 不能重复" });
  });
export type ChipContent = z.infer<typeof ChipContentSchema>;

export const SlottedChipSchema = z.object({
  carrier: z.string().min(1),
  contentId: z.string().min(1),
  at: z.number().int(),
});
export type SlottedChip = z.infer<typeof SlottedChipSchema>;

/** 角色已经亲自读到的原文；read 只表示玩家是否打开过界面。 */
export const ShardSchema = z.object({
  id: z.number().int().positive(),
  contentId: z.string().min(1),
  partId: z.string().min(1),
  carrier: z.string().nullable(),
  category: ChipCategorySchema.default("intel"),
  kind: ShardKindSchema,
  title: z.string().min(1).max(SHARD_TITLE_CHARS),
  from: z.string().min(1).max(SHARD_FROM_CHARS).nullable(),
  text: z.string().min(1),
  media: ContentMediaListSchema.optional(),
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
  /** 已解开的加密分段（carrier -> partId[]，按实体载体独立记录） */
  unlocked: z.record(z.string(), z.array(z.string())).default({}),
  /** 已用隔离读写器沙盒查毒/检测过的实体载体 id */
  inspected: z.array(z.string()).default([]),
  /** 已清毒/解除黑冰的实体载体 id */
  cleansed: z.array(z.string()).default([]),
  /** 已提取过欧元的信用芯片载体 id */
  drained: z.array(z.string()).default([]),
  /** 个人颈后神经芯片槽（最多 2 槽） */
  slots: z.array(SlottedChipSchema).max(NEURAL_CHIP_SLOTS).default([]),
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
    category: ChipCategorySchema.default("intel"),
    kind: ShardKindSchema,
    title: z.string().trim().min(1).max(SHARD_TITLE_CHARS),
    from: z.string().trim().min(1).max(SHARD_FROM_CHARS).optional(),
    text: z
      .string()
      .trim()
      .min(1)
      .max(SHARD_PART_CHARS)
      .describe("角色已经实际读到的原文；不能覆盖定稿或录入未解开部分"),
    media: ContentMediaListSchema.optional(),
    related: z
      .array(z.string().min(1))
      .max(20)
      .default([])
      .describe("实际关联的人物、地点、作品 id，用于以后召回"),
  })
  .describe("角色实际阅读的现场读物、邮件、日记或录音；拿到载体或打开旧档案不发此指令。");
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
      .describe("向空白载体刻录新内容时填写读写器 id；登记已有来历载体时可省略"),
    content: ChipContentSchema,
    reason: z.string().min(1).max(240).optional(),
  }),
  z.object({
    type: z.literal("chip"),
    action: z.literal("read"),
    carrier: z.string().min(1),
    device: z
      .string()
      .min(1)
      .optional()
      .describe("可选：使用隔离读写器或接入仓读取；省略表示直接通过个人颈后神经槽读取"),
    parts: z
      .array(z.string().min(1))
      .min(1)
      .max(40)
      .describe("本次实际读到的分段 id，不能把尚未解密的分段直接读出"),
  }),
  z.object({
    type: z.literal("chip"),
    action: z.literal("inspect"),
    carrier: z.string().min(1),
    device: z.string().min(1).describe("隔离读写器 id（如 chip-reader-writer），沙盒查毒防反噬"),
  }),
  z.object({
    type: z.literal("chip"),
    action: z.literal("decrypt"),
    carrier: z.string().min(1),
    parts: z
      .array(z.string().min(1))
      .max(40)
      .optional()
      .describe("要解开的加密分段 id；省略则解开该芯片全部加密分段"),
    device: z
      .string()
      .min(1)
      .optional()
      .describe(
        "可选：用于破译的完好网络接入仓或配合接入仓使用的隔离读写器 id；省略自动检测身上完好接入仓",
      ),
    cleanHazard: z.boolean().optional().describe("本次是否顺带清除恶意病毒或黑冰"),
    extractEddies: z.boolean().optional().describe("破译加密信用芯片后是否提取内含欧元"),
  }),
  z.object({
    type: z.literal("chip"),
    action: z.literal("equip"),
    carrier: z.string().min(1).describe("插入个人颈后神经槽的 skill 或 behavior 芯片载体 id"),
  }),
  z.object({
    type: z.literal("chip"),
    action: z.literal("unequip"),
    carrier: z.string().min(1).describe("从个人颈后神经槽拔出的芯片载体 id"),
  }),
  z.object({
    type: z.literal("chip"),
    action: z.literal("copy"),
    carrier: z.string().min(1),
    destination: z.string().min(1),
    device: z.string().min(1).describe("隔离读写器 id（需具备刻录能力）"),
    reason: z.string().min(1).max(240),
  }),
]);
export type ChipCommand = z.infer<typeof ChipCommandSchema>;

export const ShardReadSchema = z.object({
  type: z.literal("shards.read"),
  ids: z.array(z.number().int().positive()).max(SHARDS_READ_BATCH),
});
export type ShardRead = z.infer<typeof ShardReadSchema>;

export const ShardRegisterSchema = z.strictObject({
  type: z.literal("shards.register"),
  content: ChipContentSchema,
});
export type ShardRegister = z.infer<typeof ShardRegisterSchema>;

export type ShardsInternal = ShardRead | ShardRegister;
