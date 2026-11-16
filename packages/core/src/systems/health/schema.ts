import { z } from "zod";
import { DamageTierSchema } from "../dice";

/** 正常、倒下、濒死、死亡 */
export const ConditionSchema = z.enum(["up", "down", "dying", "dead"]);
export type Condition = z.infer<typeof ConditionSchema>;

/** 伤势状态：完好 / 表皮擦伤 / 贯通重创 / 机能重残 / 濒死休克 */
export const WoundSlotSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);
export type WoundSlot = z.infer<typeof WoundSlotSchema>;

export const WOUND_SLOT_LABELS: Readonly<Record<WoundSlot, string>> = {
  0: "体征平稳",
  1: "表皮擦伤",
  2: "贯通重创",
  3: "机能重残",
  4: "濒死休克",
};

/** 伤在哪一处解剖部位 */
export const BodyPartSchema = z.enum([
  "head",
  "face",
  "chest",
  "belly",
  "left-arm",
  "right-arm",
  "left-leg",
  "right-leg",
]);
export type BodyPart = z.infer<typeof BodyPartSchema>;
export const BODY_PART_LABELS: Readonly<Record<BodyPart, string>> = {
  head: "头",
  face: "脸",
  chest: "胸口",
  belly: "肚子",
  "left-arm": "左臂",
  "right-arm": "右臂",
  "left-leg": "左腿",
  "right-leg": "右腿",
};

/** 具体伤势：非战斗伤害（跌落、电击、爆破、代价等）记下部位、原因、档位与愈合时间；战斗伤口由 combat.wounds 单独留档 */
export const INJURY_TIER_LABELS = {
  graze: "擦伤",
  heavy: "重创",
  lethal: "致命伤",
} as const;

export const InjurySchema = z.object({
  id: z.string().min(1),
  part: BodyPartSchema.nullable().default(null),
  tier: DamageTierSchema,
  cause: z.string().min(1),
  at: z.number().int(),
  healsAt: z.number().int().nullable().default(null),
  treated: z.boolean().default(false),
});
export type Injury = z.infer<typeof InjurySchema>;

/** 生死线三大保底通道 */
export const DeathLineChannelSchema = z.enum([
  "traumaPlatinum",
  "secondHeartOrAlly",
  "deathCityCurtain",
]);
export type DeathLineChannel = z.infer<typeof DeathLineChannelSchema>;

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
  /** 内部伤势阶段（0 完好 / 1 擦伤 / 2 重创 / 3 重残 / 4 濒死） */
  wounds: WoundSlotSchema.default(0),
  /** 是否已打医疗针临时压制本场【重创 -2】疼痛减值 */
  painSuppressed: z.boolean().default(false),
  /** 进入重伤的游戏时间；不在重伤时为 null */
  severeSince: z.number().int().nullable(),
  /** 这次重伤已经按天失血几次 */
  bleeds: z.number().int().min(0),
  /** 最近一次扣血用的检定 id；同一次检定只扣一次 */
  damagedBy: z.string().nullable(),
  /** 具体伤势档案（部位、原因、愈合期）；战斗伤口由 combat.wounds 单独留档 */
  injuries: z.array(InjurySchema).default([]),
  /** 断了还没装义肢的部位 */
  lostLimbs: z.array(LimbSchema).default([]),
  /** 被打坏、还没修的义体 id；修好前失去能力 */
  brokenChrome: z.array(z.string()).default([]),
});
export type HealthState = z.infer<typeof HealthStateSchema>;

/** 模型使用：{"type": "damage", "tier": "graze", "part": "left-leg", "reason": "..."}，只能在掷骰失败或惨胜代价后出现 */
export const DamageCommandSchema = z
  .object({
    type: z.literal("damage"),
    tier: DamageTierSchema,
    /** 伤在哪处部位（head/face/chest/belly/left-arm/right-arm/left-leg/right-leg） */
    part: BodyPartSchema.optional(),
    /** 断了哪里：只在 check 写了 limb 的致命档失败时写 */
    limb: LimbSchema.optional(),
    reason: z.string().min(1),
  })
  .describe(
    "受伤记账：当本轮物理与局势裁决确认玩家受伤、或惨胜付出身体代价时写入；part 填受伤部位（head/face/chest/belly/left-arm/right-arm/left-leg/right-leg），reason 写明具体致伤经过；档位不超过裁决的伤害范围；limb 只在写明断肢级重创时写",
  );
export type DamageCommand = z.infer<typeof DamageCommandSchema>;

/** 模型使用：{"type": "heal", "source": "maxdoc"} */
export const HealCommandSchema = z
  .object({
    type: z.literal("heal"),
    source: z.enum(["maxdoc", "ripperdoc", "rest"]),
    reason: z.string().min(1).optional(),
  })
  .describe(
    "处理伤势：maxdoc 打医疗针临时压制重创疼痛或回伤势，ripperdoc 找义体医生缝合，rest 休整消除挂彩",
  );
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
  /** 战斗登记伤口时按档位扣血，不再选择拿义体或肢体抵伤 */
  "health.hit": z.object({
    type: z.literal("health.hit"),
    tier: DamageTierSchema,
    reason: z.string().min(1),
  }),
};
export type HealthInternal = z.infer<
  (typeof HealthInternalSchemas)[keyof typeof HealthInternalSchemas]
>;
