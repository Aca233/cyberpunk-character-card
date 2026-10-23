import { z } from "zod";

/** 五项属性，照原作：肉体、反应、技术、智力、镇定 */
export const AttributeSchema = z.enum(["body", "reflexes", "tech", "intelligence", "cool"]);
export type Attribute = z.infer<typeof AttributeSchema>;

export const ATTRIBUTE_LABELS: Readonly<Record<Attribute, string>> = {
  body: "肉体",
  reflexes: "反应",
  tech: "技术",
  intelligence: "智力",
  cool: "镇定",
};

/** 对手档位：混混、精锐、精英、传奇 */
export const TierSchema = z.enum(["street", "veteran", "elite", "legend"]);
export type Tier = z.infer<typeof TierSchema>;

/** 难度值的基础值按对手档位给；这张表只在这里写一份 */
export const OPPONENT_TIERS: Readonly<
  Record<Tier, { readonly label: string; readonly dv: readonly [number, number] }>
> = {
  street: { label: "街头混混", dv: [9, 13] },
  veteran: { label: "帮派精锐和公司保安", dv: [15, 17] },
  elite: { label: "荒坂精英和 MaxTac", dv: [21, 25] },
  legend: { label: "传奇人物", dv: [27, 29] },
};

/** 难度模式：街头传说、夜之城、死亡之城 */
export const DifficultySchema = z.enum(["streetLegend", "nightCity", "deathCity"]);
export type Difficulty = z.infer<typeof DifficultySchema>;

/** 失败时的伤害档位：擦伤、重击、致命 */
export const DamageTierSchema = z.enum(["graze", "heavy", "lethal"]);
export type DamageTier = z.infer<typeof DamageTierSchema>;

export const ModifierSchema = z.object({
  /** 来源：本事、义体、物品、队员、关系、准备…… */
  source: z.string().min(1),
  value: z.number().int(),
  reason: z.string().min(1),
});
export type Modifier = z.infer<typeof ModifierSchema>;

const PositiveModifier = ModifierSchema.extend({ value: z.number().int().min(1) });

/** 主持人返回的 check：掷骰前先说清成功和失败会怎样 */
export const CheckSpecSchema = z.object({
  intent: z.string().min(1).describe("玩家想做成什么"),
  attribute: AttributeSchema,
  tier: TierSchema,
  /** 难度值的基础值，必须落在对手档位的范围内 */
  dv: z.number().int().describe("基础难度值，落在档位范围内"),
  /** 加成，合计最多 +4 */
  bonuses: z.array(PositiveModifier).default([]),
  /** 减值（戒断、伤势、恶劣环境），写正数，合计最多 −4 */
  penalties: z.array(PositiveModifier).default([]),
  /** 基础值之上的难度值修正，合计最多 +4；降低难度写负数 */
  dvMods: z.array(ModifierSchema.refine((m) => m.value !== 0, "修正不能为 0")).default([]),
  success: z.string().min(1).describe("成功会怎样"),
  failure: z.string().min(1).describe("失败会怎样，后果不会比这更重"),
  /** 失败时最多扣到哪一档；不写表示失败不扣血 */
  damage: DamageTierSchema.optional().describe("失败最多扣到哪一档；不写表示失败不扣血"),
});
export type CheckSpec = z.infer<typeof CheckSpecSchema>;

export const DiceStateSchema = z.object({ mode: DifficultySchema });
export type DiceState = z.infer<typeof DiceStateSchema>;
