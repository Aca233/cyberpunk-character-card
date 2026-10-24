import { z } from "zod";

export const HUMANITY_MAX = 100;
/** 单次扣除上限：失去锚点的 −15 是最重的一档 */
export const LOSS_CAP = 15;
/** 每个游戏日最多恢复多少；有锚点时是 12，锚点在 M2b 加入 */
export const DAILY_RECOVERY_CAP = 8;
export const MINUTES_PER_DAY = 1440;

/** 义体耐受：建角色时选，乘在义体的人性消耗上 */
export const ToleranceSchema = z.enum(["low", "normal", "high"]);
export type Tolerance = z.infer<typeof ToleranceSchema>;
export const TOLERANCE_FACTOR: Readonly<Record<Tolerance, number>> = {
  low: 1.3,
  normal: 1,
  high: 0.7,
};

export const HumanityStateSchema = z.object({
  current: z.number().int().min(0).max(HUMANITY_MAX),
  /** 已装义体的人性消耗之和；义体系统通过内部指令更新 */
  cyberwareCost: z.number().int().min(0).max(HUMANITY_MAX),
  /** 旧存档没有：都按普通 */
  tolerance: ToleranceSchema.default("normal"),
  /** 某个游戏日（序号）已经恢复了多少 */
  recovery: z.object({ day: z.number().int(), amount: z.number().int().min(0) }),
  /** 已经结算过的事件 id；同一事件只结算一次 */
  settled: z.array(z.string()),
});
export type HumanityState = z.infer<typeof HumanityStateSchema>;

/** 模型使用：{"type": "humanity", "delta": -2, "reason": "..."} */
export const HumanityCommandSchema = z
  .object({
    type: z.literal("humanity"),
    delta: z
      .number()
      .int()
      .refine((v) => v !== 0, "人性变化不能为 0"),
    reason: z.string().min(1),
    /** 事件 id，例如锚点死亡；带上后同一事件只结算一次 */
    event: z.string().min(1).optional(),
  })
  .describe(
    "人性变化：残忍行为 −2 至 −5，失去重要的人 −10 至 −15，休整 +3，有意义的休整 +5，和锚点相处 +8；单次和每天的恢复有上限，代码截断",
  );
export type HumanityCommand = z.infer<typeof HumanityCommandSchema>;

/** 只能由代码发出：义体装卸后更新消耗合计 */
export const SetCyberwareCostSchema = z.object({
  type: z.literal("humanity.setCyberwareCost"),
  total: z.number().int().min(0).max(HUMANITY_MAX),
});
export type SetCyberwareCost = z.infer<typeof SetCyberwareCostSchema>;

/** 只能由代码发出：建档时写入义体耐受；要在装开局义体之前发 */
export const SetToleranceSchema = z.object({
  type: z.literal("humanity.setTolerance"),
  tolerance: ToleranceSchema,
});
export type SetTolerance = z.infer<typeof SetToleranceSchema>;
