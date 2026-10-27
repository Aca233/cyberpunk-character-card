import { z } from "zod";

/** 收进数据库的芯片最多留这么多块，满了先删最早读到的 */
export const SHARDS_KEPT = 60;
export const SHARD_TITLE_CHARS = 24;
export const SHARD_FROM_CHARS = 24;
export const SHARD_TEXT_CHARS = 600;

/** 读物统一叫芯片（原作 SHARDS）：recording 录音，email 邮件，diary 日记，data 其余资料 */
export const ShardKindSchema = z.enum(["recording", "email", "diary", "data"]);
export type ShardKind = z.infer<typeof ShardKindSchema>;
export const SHARD_KIND_LABELS: Readonly<Record<ShardKind, string>> = {
  recording: "录音",
  email: "邮件",
  diary: "日记",
  data: "资料",
};

/** 玩家角色读过的芯片；原文就是玩家看到的，整条都能进玩家视图 */
export const ShardSchema = z.object({
  id: z.number().int().positive(),
  kind: ShardKindSchema,
  title: z.string().min(1).max(SHARD_TITLE_CHARS),
  from: z.string().min(1).max(SHARD_FROM_CHARS).nullable(),
  text: z.string().min(1).max(SHARD_TEXT_CHARS),
  at: z.number().int(),
  /** 玩家在数据库页打开过 */
  read: z.boolean(),
});
export type Shard = z.infer<typeof ShardSchema>;

export const ShardsStateSchema = z.object({
  shards: z.array(ShardSchema).default([]),
  nextShard: z.number().int().positive().default(1),
});
export type ShardsState = z.infer<typeof ShardsStateSchema>;

/** 模型使用：玩家角色真的读了、听了一块芯片 */
export const ShardCommandSchema = z
  .object({
    type: z.literal("shard"),
    kind: ShardKindSchema.describe("recording 录音，email 邮件，diary 日记，data 其余资料"),
    title: z.string().trim().min(1).max(SHARD_TITLE_CHARS),
    from: z
      .string()
      .trim()
      .min(1)
      .max(SHARD_FROM_CHARS)
      .optional()
      .describe("谁写的、谁录的；不知道就省掉"),
    text: z
      .string()
      .trim()
      .min(1)
      .max(SHARD_TEXT_CHARS)
      .describe("芯片原文，就是玩家角色读到、听到的那些；加密没解开、没读到的部分不写"),
  })
  .describe(
    "芯片：玩家角色读了芯片、邮件、日记或听了录音时写一条，原文收进数据库页，玩家随时能翻；同一块别重复写",
  );
export type ShardCommand = z.infer<typeof ShardCommandSchema>;

/** 界面使用：在数据库页打开芯片 */
export const ShardReadSchema = z.object({
  type: z.literal("shards.read"),
  ids: z.array(z.number().int().positive()).max(SHARDS_KEPT),
});
export type ShardRead = z.infer<typeof ShardReadSchema>;
export type ShardsInternal = ShardRead;
