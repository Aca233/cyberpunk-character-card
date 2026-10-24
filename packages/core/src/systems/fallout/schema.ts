import { z } from "zod";

/** 代码能从指令里认出来的后果种类 */
export const FALLOUT_KINDS = [
  "injury",
  "money",
  "heat",
  "deadline",
  "relationship",
  "item",
  "humanity",
  "fight",
  "job",
  "alert",
] as const;
export const FalloutKindSchema = z.enum(FALLOUT_KINDS);
export type FalloutKind = z.infer<typeof FalloutKindSchema>;

export const FALLOUT_LABELS: Readonly<Record<FalloutKind, string>> = {
  injury: "受伤",
  money: "破财",
  heat: "警方热度",
  deadline: "期限压过来",
  relationship: "关系变坏",
  item: "丢东西",
  humanity: "人性受损",
  fight: "打起来",
  job: "委托黄了",
  alert: "被察觉",
};

/** 记最近这么多次后果 */
export const FALLOUT_RECENT = 6;

export const FalloutEntrySchema = z.object({
  at: z.number().int(),
  kinds: z.array(FalloutKindSchema),
  /** 这一轮写的是一次失败的检定 */
  failed: z.boolean(),
});
export type FalloutEntry = z.infer<typeof FalloutEntrySchema>;

export const FalloutStateSchema = z.object({
  recent: z.array(FalloutEntrySchema).default([]),
  /** 检定失败了还没落下实际后果；再过 left 轮没落地就不再提醒 */
  owed: z
    .object({ id: z.string().min(1), left: z.number().int().min(0) })
    .nullable()
    .default(null),
});
export type FalloutState = z.infer<typeof FalloutStateSchema>;

/** 只能由主持流程发出：这一轮真正生效的指令里认出来的后果 */
export const FalloutRecordSchema = z.object({
  type: z.literal("fallout.record"),
  kinds: z.array(FalloutKindSchema),
});
export type FalloutRecord = z.infer<typeof FalloutRecordSchema>;

/** 后果参考表的一行：数据在 content 包的 jobs.ts */
export const ConsequenceTierSchema = z.object({
  /** 对应委托星级 1–5 */
  risk: z.number().int().min(1).max(5),
  /** 这一档的分量，例如“吃点小亏” */
  label: z.string().min(1),
  examples: z.array(z.string().min(1)).min(1),
});
export type ConsequenceTier = z.infer<typeof ConsequenceTierSchema>;

export const ConsequenceTableSchema = z.array(ConsequenceTierSchema).superRefine((rows, ctx) => {
  const risks = rows.map((r) => r.risk).sort();
  if (risks.join() !== "1,2,3,4,5")
    ctx.addIssue({ code: "custom", message: "后果参考表要正好有 1 到 5 星各一行" });
});
