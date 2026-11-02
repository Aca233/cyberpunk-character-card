import { z } from "zod";
import { DamageTierSchema } from "../dice";

/** 正常、倒下、濒死、死亡 */
export const ConditionSchema = z.enum(["up", "down", "dying", "dead"]);
export type Condition = z.infer<typeof ConditionSchema>;

/** 断肢的部位 */
export const LimbSchema = z.enum(["left-arm", "right-arm", "left-leg", "right-leg"]);
export type Limb = z.infer<typeof LimbSchema>;
export const LIMB_LABELS: Readonly<Record<Limb, string>> = {
  "left-arm": "左臂",
  "right-arm": "右臂",
  "left-leg": "左腿",
  "right-leg": "右腿",
};
/** 部位对应的义体部位：两条胳膊共用手臂义体，两条腿共用腿部义体 */
export function limbSlot(limb: Limb): "arms" | "legs" {
  return limb.endsWith("arm") ? "arms" : "legs";
}

/** turn 放进事实的手臂、腿部义体（health 不能直接读义体，会成环） */
export const ChromeLimbsFactSchema = z.object({
  arms: z.object({ id: z.string(), name: z.string() }).optional(),
  legs: z.object({ id: z.string(), name: z.string() }).optional(),
});

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
  /** 断了还没装义肢的部位 */
  lostLimbs: z.array(LimbSchema).default([]),
  /** 被打坏、还没修的义体 id；修好前失去能力 */
  brokenChrome: z.array(z.string()).default([]),
});
export type HealthState = z.infer<typeof HealthStateSchema>;

/** 模型使用：{"type": "damage", "tier": "graze", "reason": "..."}，只能在掷骰失败后出现 */
export const DamageCommandSchema = z
  .object({
    type: z.literal("damage"),
    tier: DamageTierSchema,
    /** 断了哪里：只在 check 写了 limb 的致命档失败时写 */
    limb: LimbSchema.optional(),
    reason: z.string().min(1),
  })
  .describe(
    "扣血：只能出现在检定失败的那一轮，档位不超过 check 事先写的 damage；limb 只在 check 写了 limb 的致命档失败时写",
  );
export type DamageCommand = z.infer<typeof DamageCommandSchema>;

/** 模型使用：{"type": "heal", "source": "maxdoc"} */
export const HealCommandSchema = z
  .object({
    type: z.literal("heal"),
    source: z.enum(["maxdoc", "ripperdoc", "rest"]),
    reason: z.string().min(1).optional(),
  })
  .describe("回血：maxdoc 用快捷栏里的治疗品，ripperdoc 找义体医生，rest 休整");
export type HealCommand = z.infer<typeof HealCommandSchema>;

/** 只能由代码发出：建档和成长改上限、救治倒下或濒死的角色、判定死亡 */
export const HealthInternalSchemas = {
  "health.setMax": z.object({ type: z.literal("health.setMax"), max: z.number().int().min(1) }),
  "health.revive": z.object({ type: z.literal("health.revive") }),
  "health.die": z.object({ type: z.literal("health.die"), reason: z.string().min(1) }),
  /** fit 装上手臂或腿部义体，补上断了的；repair 义体医生修好打坏的义体；clear 义体卸下时去掉损坏记录 */
  "health.limb": z.object({
    type: z.literal("health.limb"),
    action: z.enum(["fit", "repair", "clear"]),
    slot: z.enum(["arms", "legs"]).optional(),
    id: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
  }),
  /**
   * 战斗里没拦下、打中你的一下（用户 2026-11-02 定的"战斗推倒重来"）：你挑拿什么抵。
   * chrome 打坏一件义体（不扣血），limb 断一条胳膊腿（降一档扣血），flesh 照档位扣血
   */
  "health.hit": z.object({
    type: z.literal("health.hit"),
    tier: DamageTierSchema,
    pay: z.enum(["chrome", "limb", "flesh"]),
    chrome: z.string().min(1).optional(),
    limb: LimbSchema.optional(),
    reason: z.string().min(1),
  }),
};
export type HealthInternal = z.infer<
  (typeof HealthInternalSchemas)[keyof typeof HealthInternalSchemas]
>;
