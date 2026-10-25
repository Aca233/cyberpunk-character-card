import { z } from "zod";

/** 锚点最多几个 */
export const ANCHORS_MAX = 3;
/** 记忆空白只留最近几段 */
export const BLACKOUTS_KEPT = 10;
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
  /** 最近一次发作在第几个场景；一个场景最多一次 */
  episodeScene: z.number().int().nullable().default(null),
  /** 发作过的事件 id：同一件事只发作一次 */
  events: z.array(z.string()).default([]),
  /** 严重发作留下的记忆空白：哪个场景、从几点起；场景结束时记下 to。只留最近 BLACKOUTS_KEPT 段 */
  blackouts: z
    .array(
      z.object({
        scene: z.number().int(),
        from: z.number().int(),
        to: z.number().int().nullable(),
      }),
    )
    .default([]),
  /** 短暂失控过几次 */
  lostControl: z.number().int().min(0).default(0),
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

/** 模型使用：{"type": "episode", "trigger": "...", "severity": "mild", "reason": "..."} */
export const EpisodeCommandSchema = z
  .object({
    type: z.literal("episode"),
    trigger: z
      .string()
      .min(1)
      .max(80)
      .describe("诱因：重大失败、连续过载义体、重要的人死去、和旧创伤有关的刺激"),
    severity: z
      .enum(["mild", "severe"])
      .describe("mild 一阵失真和冲动；severe 严重到事后记不清，之后这一段成为记忆空白"),
    event: z.string().min(1).optional().describe("这件事的 id；同一件事只发作一次"),
    reason: z.string().min(1),
  })
  .describe(
    "赛博精神病发作：只在人性低于 40、合乎情理的高压时刻写；每个场景最多一次，代码拒绝第二次",
  );
export type EpisodeCommand = z.infer<typeof EpisodeCommandSchema>;

/** 模型使用：{"type": "lostControl", "intent": "...", "actual": "..."} */
export const LostControlCommandSchema = z
  .object({
    type: z.literal("lostControl"),
    intent: z.string().min(1).max(120).describe("玩家原本想做的，照玩家的输入概括"),
    actual: z.string().min(1).max(160).describe("实际发生的事"),
  })
  .describe(
    "短暂失控：这个场景发作过、检定失败时才写；界面标 [失控] 并同时显示意图和实际。不改写玩家的输入，不替玩家去杀人",
  );
export type LostControlCommand = z.infer<typeof LostControlCommandSchema>;

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
