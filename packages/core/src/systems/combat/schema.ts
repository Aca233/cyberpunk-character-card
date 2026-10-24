import { z } from "zod";
import { TierSchema } from "../dice";

/** 敌群：杂兵不建卡，按档位和大致人数合成一组 */
export const EnemyGroupSchema = z.object({
  group: z.string().min(1),
  tier: TierSchema,
  count: z.number().int().min(1).max(50),
});
export type EnemyGroup = z.infer<typeof EnemyGroupSchema>;

/** 有名有姓的敌人：有人物卡，按成功次数打到濒死，不按伤害百分比 */
export const FoeSchema = z.object({
  npc: z.string().min(1).describe("人物卡 id"),
  tier: TierSchema,
  /** 装着护甲义体：多要 1 次成功 */
  armor: z.boolean().optional(),
});
export type Foe = z.infer<typeof FoeSchema>;

export const ActiveFoeSchema = z.object({
  npc: z.string().min(1),
  name: z.string().min(1),
  tier: TierSchema,
  /** 打到濒死要几次成功 */
  need: z.number().int().min(1).max(4),
  hits: z.number().int().min(0),
  /** 有没有靠掷骰打中过：传奇档对手至少要掷一次骰 */
  rolled: z.boolean(),
  /** 玩家扫描过才显示血条 */
  scanned: z.boolean(),
});
export type ActiveFoe = z.infer<typeof ActiveFoeSchema>;

/** 有卡敌人打到濒死要几次成功：混混 1 次、精锐 2 次、精英和传奇 3 次；护甲义体多 1 次 */
export const FOE_HITS = { street: 1, veteran: 2, elite: 3, legend: 3 } as const;

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
  enemies: z.array(EnemyGroupSchema),
  /** 有卡敌人；旧存档里没有 */
  foes: z.array(ActiveFoeSchema).default([]),
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
    action: z.enum(["start", "next", "retreat", "end", "scan"]),
    moments: z.number().int().min(1).max(3).optional(),
    defeat: z.string().min(1).optional(),
    enemies: z.array(EnemyGroupSchema).min(1).max(6).optional(),
    /** 有卡敌人，不放进敌群 */
    foes: z.array(FoeSchema).min(1).max(4).optional(),
    /** next：这次主行动打的是哪个有卡敌人；scan：扫描了谁 */
    target: z.string().min(1).optional(),
  })
  .superRefine((c, ctx) => {
    if (c.action === "start") {
      if (c.moments === undefined || c.defeat === undefined) {
        ctx.addIssue({ code: "custom", message: "开战要写 moments 和 defeat" });
      }
      if (c.enemies === undefined && c.foes === undefined) {
        ctx.addIssue({ code: "custom", message: "开战要写 enemies 或 foes" });
      }
    }
    if (c.action === "scan" && c.target === undefined) {
      ctx.addIssue({ code: "custom", message: "scan 要写 target" });
    }
  })
  .describe(
    "战斗：start 开打（要写 moments、defeat，敌群写 enemies，有人物卡的敌人写 foes），next 结算当前交锋（主行动打的是有卡敌人时写 target），retreat 撤退，end 上一次交锋赢了以后提前收场，scan 玩家扫描了某个有卡敌人",
  );
export type CombatCommand = z.infer<typeof CombatCommandSchema>;

/** 主持流程放进 ctx.facts.direct：这次主行动没掷骰，直接成功或门槛达标 */
export const DirectFactSchema = z.boolean().optional();
