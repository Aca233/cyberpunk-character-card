import { z } from "zod";

/** 记忆空白只留最近几段 */
export const BLACKOUTS_KEPT = 10;
/** 被拉回来以后人性回到多少 */
export const CRISIS_RESTORE = 20;
/** 被拉回来以后的恢复期（分钟） */
export const CRISIS_RECOVERY = 7 * 1440;
/** 被拉回来时最多留下几件义体、这几件的人性消耗合计不超过多少；其余都拆掉（本作改编） */
export const CRISIS_KEEP_PIECES = 2;
export const CRISIS_KEEP_COST = 30;

export const CrisisStatusSchema = z.enum(["open", "recovering", "lastStand", "surrendered"]);
export type CrisisStatus = z.infer<typeof CrisisStatusSchema>;
export const CRISIS_LABELS: Readonly<Record<CrisisStatus, string>> = {
  open: "危机章节",
  recovering: "恢复期",
  lastStand: "最后一战",
  surrendered: "已向暴恐机动队投降",
};
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

/** 旧存档里的 anchors、lost 两个字段载入时直接丢掉（z.object 默认不保留未知键） */
export const PsychosisStateSchema = z.object({
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
  /** 危机章节：人性归零时打开；until 是恢复期结束的时间 */
  crisis: z
    .object({
      since: z.number().int(),
      status: CrisisStatusSchema,
      until: z.number().int().nullable(),
    })
    .nullable()
    .default(null),
  /** 经历过几次危机 */
  crises: z.number().int().min(0).default(0),
});
export type PsychosisState = z.infer<typeof PsychosisStateSchema>;

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
    "短暂失控：这个场景发作过、精神防线彻底崩不住失控时才写；界面标 [失控] 并同时显示意图和实际。不改写玩家的输入，不替玩家去杀人",
  );
export type LostControlCommand = z.infer<typeof LostControlCommandSchema>;

/** 模型使用：{"type": "crisis", "path": "pulledBack", "who": "维克多", "reason": "..."} */
export const CrisisCommandSchema = z
  .object({
    type: z.literal("crisis"),
    path: z
      .enum(["pulledBack", "lastStand", "surrender"])
      .describe(
        "pulledBack 被身边的人或诊所拉回来（人确实被稳住、危机平息后才写），lastStand 带着全部义体走向最后一战，surrender 向暴恐机动队投降",
      ),
    who: z.string().min(1).max(40).optional().describe("pulledBack：谁把角色拉回来"),
    reason: z.string().min(1),
  })
  .describe(
    "危机章节的走向：只在人性归零、危机章节里写。pulledBack 由代码拆掉大部分义体、人性回到 20、进入 7 天恢复期",
  );
export type CrisisCommand = z.infer<typeof CrisisCommandSchema>;
