import { z } from "zod";

/** 五项属性，照原作 3.0（1~10 点标度）：肉体、反应、技术、智力、镇定 */
export const AttributeSchema = z.enum(["body", "reflexes", "tech", "intelligence", "cool"]);
export type Attribute = z.infer<typeof AttributeSchema>;

export const ATTRIBUTE_LABELS: Readonly<Record<Attribute, string>> = {
  body: "肉体",
  reflexes: "反应",
  tech: "技术",
  intelligence: "智力",
  cool: "镇定",
};

/** 万物四阶划分（武器、义体、人物、门禁、防火墙、场所共用）：T1 街头 / T2 佣兵 / T3 精英 / T4 传奇 */
export const TierSchema = z.enum(["street", "veteran", "elite", "legend"]);
export type Tier = z.infer<typeof TierSchema>;

export type TierNumber = 1 | 2 | 3 | 4;
export const TierNumberSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);

export const TIER_NUMBERS: Readonly<Record<Tier, TierNumber>> = {
  street: 1,
  veteran: 2,
  elite: 3,
  legend: 4,
};

export const NUMBER_TO_TIER: Readonly<Record<TierNumber, Tier>> = {
  1: "street",
  2: "veteran",
  3: "elite",
  4: "legend",
};

/**
 * 3.0 钟形骰池（2d6）下的四阶基础 DV 表：
 * T1 街头级 = 8，T2 佣兵/精锐级 = 11，T3 精英级 = 14，T4 传奇级 = 18
 */
export const OPPONENT_TIERS: Readonly<
  Record<
    Tier,
    {
      readonly label: string;
      readonly tierNumber: TierNumber;
      readonly baseDv: number;
      readonly dv: readonly [number, number];
    }
  >
> = {
  street: { label: "T1 街头级", tierNumber: 1, baseDv: 8, dv: [8, 9] },
  veteran: { label: "T2 佣兵精锐", tierNumber: 2, baseDv: 11, dv: [11, 12] },
  elite: { label: "T3 精英级", tierNumber: 3, baseDv: 14, dv: [14, 15] },
  legend: { label: "T4 传奇级", tierNumber: 4, baseDv: 18, dv: [18, 19] },
};

/** 难度模式：街头传说、夜之城、死亡之城 */
export const DifficultySchema = z.enum(["streetLegend", "nightCity", "deathCity"]);
export type Difficulty = z.infer<typeof DifficultySchema>;

/** 武器技术体系（Power 动能机械 / Tech 电磁穿甲 / Smart 微陀螺智能制导） */
export const WeaponTechSchema = z.enum(["power", "tech", "smart"]);
export type WeaponTech = z.infer<typeof WeaponTechSchema>;

/** 物理防护装甲等级（0 无甲便服 / 1 轻型防弹或基础皮下甲 / 2 重型战术甲或军用皮下甲 / 3 全身重型外骨骼机甲） */
export const ArmorGradeSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
export type ArmorGrade = z.infer<typeof ArmorGradeSchema>;

/** 武器穿甲等级（1 轻武器手枪/冲锋枪/刀刃 / 2 步枪/穿甲弹/单分子线 / 3 反器材重武/电磁满蓄力） */
export const WeaponPenetrationSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type WeaponPenetration = z.infer<typeof WeaponPenetrationSchema>;

/** 武器隐蔽度（pocket 贴身藏匿 / coat 风衣遮蔽 / open 显眼长械 / heavy 重型车载军火） */
export const WeaponConcealmentSchema = z.enum(["pocket", "coat", "open", "heavy"]);
export type WeaponConcealment = z.infer<typeof WeaponConcealmentSchema>;

/** 武器声学特征（silent 消音或冷兵器暗杀 / loud 常规枪声 / explosive 剧烈爆炸） */
export const WeaponNoiseSchema = z.enum(["silent", "loud", "explosive"]);
export type WeaponNoise = z.infer<typeof WeaponNoiseSchema>;

/** 失败时的伤害档位：擦伤（轻伤 1 级）、重击（贯通重创 2 级）、致命（失能重残/濒死 3 级） */
export const DamageTierSchema = z.enum(["graze", "heavy", "lethal"]);
export type DamageTier = z.infer<typeof DamageTierSchema>;

/** 筹码分池类别：硬件池（上限 +3）与战术池（上限 +4） */
export const BonusPoolKindSchema = z.enum(["hardware", "tactic"]);
export type BonusPoolKind = z.infer<typeof BonusPoolKindSchema>;

export const ModifierSchema = z.object({
  /** 来源：本事、义体、物品、穿搭、踩点、弱点、偷袭、掩体、队员…… */
  source: z.string().min(1),
  value: z.number().int(),
  reason: z.string().min(1),
  pool: BonusPoolKindSchema.optional(),
});
export type Modifier = z.infer<typeof ModifierSchema>;

const PositiveModifier = ModifierSchema.extend({ value: z.number().int().min(1) });

export const DiceStateSchema = z.object({
  mode: DifficultySchema,
});
export type DiceState = z.infer<typeof DiceStateSchema>;
