import { z } from "zod";

/** 锚点最多几个 */
export const ANCHORS_MAX = 3;
/** 压制剂的物品 id（本作改编的虚构药物） */
export const SUPPRESSANT_ID = "psycho-suppressant";
/** 一片压制剂管多久（分钟）；耐受以后减半 */
export const SUPPRESSANT_MINUTES = 6 * 60;
const DAY = 1440;
/** 7 天里吃到这么多次开始耐受 */
export const TOLERANCE_DOSES = 3;
export const TOLERANCE_WINDOW = 7 * DAY;
/** 14 天里吃到这么多次就依赖了 */
export const DEPENDENCE_DOSES = 5;
export const DEPENDENCE_WINDOW = 14 * DAY;
/** 依赖以后停药多久开始戒断 */
export const WITHDRAWAL_AFTER = DAY;

/** 一个锚点：玩家在人物卡上确认的过命交情 */
export const AnchorEntrySchema = z.object({
  /** 人物卡 id */
  npc: z.string().min(1),
  name: z.string().min(1),
  since: z.number().int(),
});
export type AnchorEntry = z.infer<typeof AnchorEntrySchema>;

export const AnchorLossSchema = z.enum(["dead", "broken"]);
export const ANCHOR_LOSS_LABELS: Readonly<Record<z.infer<typeof AnchorLossSchema>, string>> = {
  dead: "死去",
  broken: "决裂",
};

export const LostAnchorSchema = AnchorEntrySchema.extend({
  at: z.number().int(),
  how: AnchorLossSchema,
});

export const PsychosisStateSchema = z.object({
  anchors: z.array(AnchorEntrySchema).max(ANCHORS_MAX).default([]),
  /** 失去的锚点，旧的在前 */
  lost: z.array(LostAnchorSchema).default([]),
  /** 最近 14 天吃压制剂的时间 */
  doses: z.array(z.number().int()).default([]),
});
export type PsychosisState = z.infer<typeof PsychosisStateSchema>;

/** 模型使用：{"type": "anchor", "npc": "rebecca", "how": "dead", "reason": "..."} */
export const AnchorCommandSchema = z
  .object({
    type: z.literal("anchor"),
    npc: z.string().min(1).describe("锚点的人物卡 id"),
    how: AnchorLossSchema.describe("dead 死去，broken 和角色决裂"),
    reason: z.string().min(1),
  })
  .describe("失去锚点：锚点死去或决裂，代码扣人性 15；锚点只能由玩家在人物卡上设，不要替玩家设");
export type AnchorCommand = z.infer<typeof AnchorCommandSchema>;

/** 模型使用：{"type": "suppressant", "reason": "..."} */
export const SuppressantCommandSchema = z
  .object({
    type: z.literal("suppressant"),
    reason: z.string().min(1),
  })
  .describe("角色吞下一片压制剂：背包里要有，代码扣一件，记药效、耐受和依赖");
export type SuppressantCommand = z.infer<typeof SuppressantCommandSchema>;

export const PsychosisInternalSchemas = {
  /** 界面动作：在人物卡上设锚点或取消 */
  "psychosis.anchor": z.object({
    type: z.literal("psychosis.anchor"),
    action: z.enum(["add", "remove"]),
    npc: z.string().min(1),
  }),
};
export type PsychosisInternal = z.infer<
  (typeof PsychosisInternalSchemas)[keyof typeof PsychosisInternalSchemas]
>;
