import { z } from "zod";

export const HUMANITY_MAX = 100;
/** 单次扣除上限：失去锚点的 −15 是最重的一档 */
export const LOSS_CAP = 15;
/** 每个游戏日最多恢复多少；有锚点时是 12，锚点在 M2b 加入 */
export const DAILY_RECOVERY_CAP = 8;
export const MINUTES_PER_DAY = 1440;

export const HumanityStateSchema = z.object({
  current: z.number().int().min(0).max(HUMANITY_MAX),
  /** 已装义体的人性消耗之和；义体系统通过内部指令更新 */
  cyberwareCost: z.number().int().min(0).max(HUMANITY_MAX),
  /** 某个游戏日（序号）已经恢复了多少 */
  recovery: z.object({ day: z.number().int(), amount: z.number().int().min(0) }),
  /** 已经结算过的事件 id；同一事件只结算一次 */
  settled: z.array(z.string()),
});
export type HumanityState = z.infer<typeof HumanityStateSchema>;

/** 模型使用：{"type": "humanity", "delta": -2, "reason": "..."} */
export const HumanityCommandSchema = z.object({
  type: z.literal("humanity"),
  delta: z
    .number()
    .int()
    .refine((v) => v !== 0, "人性变化不能为 0"),
  reason: z.string().min(1),
  /** 事件 id，例如锚点死亡；带上后同一事件只结算一次 */
  event: z.string().min(1).optional(),
});
export type HumanityCommand = z.infer<typeof HumanityCommandSchema>;

/** 只能由代码发出：义体装卸后更新消耗合计 */
export const SetCyberwareCostSchema = z.object({
  type: z.literal("humanity.setCyberwareCost"),
  total: z.number().int().min(0).max(HUMANITY_MAX),
});
export type SetCyberwareCost = z.infer<typeof SetCyberwareCostSchema>;
