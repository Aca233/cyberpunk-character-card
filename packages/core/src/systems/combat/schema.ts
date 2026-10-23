import { z } from "zod";
import { TierSchema } from "../dice";

/** 敌群：杂兵不建卡，按档位和大致人数合成一组 */
export const EnemyGroupSchema = z.object({
  group: z.string().min(1),
  tier: TierSchema,
  count: z.number().int().min(1).max(50),
});
export type EnemyGroup = z.infer<typeof EnemyGroupSchema>;

export const MomentResultSchema = z.enum(["win", "lose", "draw"]);
export type MomentResult = z.infer<typeof MomentResultSchema>;

export const CombatOutcomeSchema = z.enum(["victory", "defeat", "retreat"]);
export type CombatOutcome = z.infer<typeof CombatOutcomeSchema>;

export const ActiveCombatSchema = z.object({
  startedAt: z.number().int(),
  /** 交锋总数，1–3 */
  moments: z.number().int().min(1).max(3),
  /** 当前是第几次交锋（从 0 起） */
  current: z.number().int().min(0),
  /** 开战时写明的败局 */
  defeat: z.string().min(1),
  enemies: z.array(EnemyGroupSchema).min(1),
  results: z.array(MomentResultSchema),
  /** 濒死要在这次交锋（从 0 起）结束前被救回；不在濒死时为 null */
  dyingUntil: z.number().int().min(0).nullable(),
});
export type ActiveCombat = z.infer<typeof ActiveCombatSchema>;

export const CombatStateSchema = z.object({
  active: ActiveCombatSchema.nullable(),
  /** 本场战斗已经算过交锋的检定 id；一次检定只算一次交锋 */
  usedChecks: z.array(z.string()),
  last: z
    .object({
      outcome: CombatOutcomeSchema,
      defeat: z.string().nullable(),
      endedAt: z.number().int(),
    })
    .nullable(),
});
export type CombatState = z.infer<typeof CombatStateSchema>;

/**
 * 模型使用：
 * {"type": "combat", "action": "start", "moments": 2, "defeat": "被迫撤退，货物丢失",
 *  "enemies": [{"group": "漩涡帮打手", "tier": "street", "count": 5}]}
 * action 可为 start、next（结算当前交锋）、retreat（撤退，作为这次交锋的主行动）、end（上一次交锋获胜后提前结束）
 */
export const CombatCommandSchema = z
  .object({
    type: z.literal("combat"),
    action: z.enum(["start", "next", "retreat", "end"]),
    moments: z.number().int().min(1).max(3).optional(),
    defeat: z.string().min(1).optional(),
    enemies: z.array(EnemyGroupSchema).min(1).max(6).optional(),
  })
  .superRefine((c, ctx) => {
    if (
      c.action === "start" &&
      (c.moments === undefined || c.defeat === undefined || c.enemies === undefined)
    ) {
      ctx.addIssue({ code: "custom", message: "开战要写 moments、defeat 和 enemies" });
    }
  });
export type CombatCommand = z.infer<typeof CombatCommandSchema>;

/** 主持流程放进 ctx.facts.direct：这次主行动没掷骰，直接成功或门槛达标 */
export const DirectFactSchema = z.boolean().optional();
