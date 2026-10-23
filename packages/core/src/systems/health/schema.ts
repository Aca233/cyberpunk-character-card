import { z } from "zod";
import { DamageTierSchema } from "../dice";

/** 正常、倒下、濒死、死亡 */
export const ConditionSchema = z.enum(["up", "down", "dying", "dead"]);
export type Condition = z.infer<typeof ConditionSchema>;

export const HealthStateSchema = z.object({
  hp: z.number().int().min(0),
  max: z.number().int().min(1),
  condition: ConditionSchema,
  /** 进入重伤的游戏时间；不在重伤时为 null */
  severeSince: z.number().int().nullable(),
  /** 这次重伤已经按天失血几次 */
  bleeds: z.number().int().min(0),
  /** 最近一次扣血用的检定 id；同一次检定只扣一次 */
  damagedBy: z.string().nullable(),
});
export type HealthState = z.infer<typeof HealthStateSchema>;

/** 模型使用：{"type": "damage", "tier": "graze", "reason": "..."}，只能在掷骰失败后出现 */
export const DamageCommandSchema = z.object({
  type: z.literal("damage"),
  tier: DamageTierSchema,
  reason: z.string().min(1),
});
export type DamageCommand = z.infer<typeof DamageCommandSchema>;

/** 模型使用：{"type": "heal", "source": "maxdoc"} */
export const HealCommandSchema = z.object({
  type: z.literal("heal"),
  source: z.enum(["maxdoc", "ripperdoc", "rest"]),
  reason: z.string().min(1).optional(),
});
export type HealCommand = z.infer<typeof HealCommandSchema>;

/** 只能由代码发出：建档和成长改上限、救治倒下或濒死的角色、判定死亡 */
export const HealthInternalSchemas = {
  "health.setMax": z.object({ type: z.literal("health.setMax"), max: z.number().int().min(1) }),
  "health.revive": z.object({ type: z.literal("health.revive") }),
  "health.die": z.object({ type: z.literal("health.die"), reason: z.string().min(1) }),
};
export type HealthInternal = z.infer<
  (typeof HealthInternalSchemas)[keyof typeof HealthInternalSchemas]
>;
