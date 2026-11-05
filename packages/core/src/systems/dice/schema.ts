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

/** 按 1~10 点属性值映射所属阶级（1~2: T1, 3~5: T2, 6~8: T3, 9~10: T4） */
export function attributeToTier(attributeValue: number): TierNumber {
  if (attributeValue <= 2) return 1;
  if (attributeValue <= 5) return 2;
  if (attributeValue <= 8) return 3;
  return 4;
}

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

/** 根据来源文本自动归入硬件池（本事/义体/装备/穿搭）或战术池（踩点/弱点/偷袭/环境/队友） */
export function classifyBonusPool(mod: Pick<Modifier, "source" | "pool">): BonusPoolKind {
  if (mod.pool) return mod.pool;
  const s = mod.source.toLowerCase();
  if (
    s.includes("义体") ||
    s.includes("chrome") ||
    s.includes("本事") ||
    s.includes("特长") ||
    s.includes("skill") ||
    s.includes("穿搭") ||
    s.includes("服装") ||
    s.includes("style") ||
    s.includes("物品") ||
    s.includes("武器") ||
    s.includes("gear") ||
    s.includes("入侵协议矩阵")
  ) {
    return "hardware";
  }
  return "tactic";
}

/** 叙事模型或前置裁判返回的 check */
export const CheckSpecSchema = z.object({
  intent: z.string().min(1).describe("玩家想做成什么"),
  attribute: AttributeSchema,
  tier: TierSchema,
  /** 难度值的基础值，必须落在对手档位的范围内（T1=8, T2=11, T3=14, T4=18） */
  dv: z.number().int().describe("基础难度值，落在档位范围内"),
  /** 加成（自动分入硬件池 ≤3 与战术池 ≤4） */
  bonuses: z.array(PositiveModifier).default([]),
  /** 减值（伤势、疲劳、戒断、恶劣环境），写正数 */
  penalties: z.array(PositiveModifier).default([]),
  /** 基础值之上的难度值修正；降低难度写负数 */
  dvMods: z.array(ModifierSchema.refine((m) => m.value !== 0, "修正不能为 0")).default([]),
  success: z.string().min(1).describe("成功会怎样"),
  failure: z.string().min(1).describe("失败会怎样，后果不会比这更重"),
  /** 我方所用权限/技术层级（1~4）；仅在门禁、社交权限、黑客防火墙等层级对抗时对比 */
  actorTier: TierNumberSchema.optional().describe("我方所用权限或技术层级（1~4）"),
  /** 目标物理装甲等级（0 无甲便服 / 1 轻甲 / 2 重甲 / 3 外骨骼机甲）；传入时按物理穿甲逻辑替代抽象阶级压制 */
  targetArmor: ArmorGradeSchema.optional(),
  /** 我方武器穿甲等级（1 轻武器 / 2 步枪或穿甲 / 3 重武或电磁穿甲） */
  weaponPenetration: WeaponPenetrationSchema.optional(),
  /** 武器科技体系：动能 power / 电磁技术 tech / 智能制导 smart */
  weaponTech: WeaponTechSchema.optional(),
  /** 武器声学特征：silent 消音 / loud 常规 / explosive 爆炸 */
  weaponNoise: WeaponNoiseSchema.optional(),
  /** 是否已通过义眼扫描标定掩体后目标或装甲薄弱点（配合 Tech 武器穿墙/穿甲 +1） */
  scannedTarget: z.boolean().optional(),
  /** 是否已安装智能连接义体（配合智能武器取智力/反应较高者并避免手滑走火） */
  hasSmartLink: z.boolean().optional(),
  /** 目标是否开启光学迷彩或装有虎爪帮/荒坂智能信号干扰器（令 Smart 武器制导失效） */
  targetSmartJammer: z.boolean().optional(),
  /** 角色反应与智力有效值（供智能武器取高者） */
  reflexesValue: z.number().int().min(1).max(10).optional(),
  intelligenceValue: z.number().int().min(1).max(10).optional(),
  /** 在场队友代投信息：队友对应属性高于玩家时直接由队友出手；否则提供 +1 协战 */
  squadAssist: z
    .object({
      id: z.string().min(1),
      name: z.string().min(1),
      attributeValue: z.number().int().min(1).max(10),
    })
    .optional(),
  /** 是否针对目标真实暴露的物理/心理弱点下手 */
  weakpointStrike: z.boolean().optional(),
  /** 抵抗某次快速破解时在掷骰前绑定来源 */
  npcHack: z
    .object({
      id: z.string().min(1).describe("放快速破解的 NPC 卡 id"),
      program: z.string().min(1).describe("快速破解表里的程序 id"),
    })
    .optional()
    .describe(
      "抵抗 NPC 对玩家的快速破解时填写，绑定本次检定对应的攻击；attribute 用 intelligence 或 body",
    ),
  /** 失败时最多扣到哪一档；不写表示失败不扣血 */
  damage: DamageTierSchema.optional().describe("失败最多扣到哪一档；不写表示失败不扣血"),
  /** 失败可能失去手臂或腿；只能和 damage lethal 一起写 */
  limb: z
    .boolean()
    .optional()
    .describe("失败可能失去手臂或腿（failure 里要写明）；只能和 damage: lethal 一起写"),
  /** 和有卡的人对抗时写他的卡 id */
  opponent: z
    .string()
    .min(1)
    .optional()
    .describe(
      "和有卡的人对抗时写他的卡 id（潜行躲他、骗他、和他对打）；他的义体利于这项属性时代码自动加一档难度",
    ),
});
export type CheckSpec = z.infer<typeof CheckSpecSchema>;

/** 对手义体加的难度修正的来源；同一个检定只加一次 */
export const OPPONENT_CHROME_SOURCE = "对手义体";

/** 3.0 加成与减值的一档步长：在 2d6 + 1~10 属性体系下，单项优势默认 +1（MOD_STEP = 1） */
export const MOD_STEP = 1;

/** 对手义体利于这项属性时难度提高一档 */
export function withOpponentChrome(
  spec: CheckSpec,
  opponentName: string,
  favors: readonly string[],
): CheckSpec {
  if (favors.length === 0) return spec;
  if (spec.dvMods.some((m) => m.source === OPPONENT_CHROME_SOURCE)) return spec;
  return {
    ...spec,
    dvMods: [
      ...spec.dvMods,
      {
        source: OPPONENT_CHROME_SOURCE,
        value: MOD_STEP,
        reason: `${opponentName}装着${favors.join("、")}，${ATTRIBUTE_LABELS[spec.attribute]}上占优`,
      },
    ],
  };
}

/** 上下沿：low 取对手档位标准基础 DV，high 取上沿 */
export const EdgeSchema = z.enum(["low", "high"]);
export type Edge = z.infer<typeof EdgeSchema>;

/** 难度值的基础值：3.0 固定取 T1=8, T2=11, T3=14, T4=18（high 上沿 +1） */
export function baseDv(tier: Tier, edge: Edge = "low"): number {
  return edge === "low" ? OPPONENT_TIERS[tier].baseDv : OPPONENT_TIERS[tier].dv[1];
}

/** 入侵协议矩阵小游戏最多解开几段序列 */
export const MATRIX_MAX = 3;
const MATRIX_SOURCE = "入侵协议矩阵";

/** 设置里开了矩阵小游戏时，完成情况换算成检定修正 */
export function withMatrix(spec: CheckSpec, solved: number | undefined): CheckSpec {
  if (solved === undefined || solved < 1 || spec.attribute !== "intelligence") return spec;
  const n = Math.min(Math.floor(solved), MATRIX_MAX);
  const bonuses = [...spec.bonuses];
  for (let i = 1; i <= Math.min(n, 2); i++) {
    bonuses.push({
      source: MATRIX_SOURCE,
      value: MOD_STEP,
      reason: `解开第 ${i} 段序列`,
      pool: "hardware",
    });
  }
  const dvMods =
    n >= MATRIX_MAX
      ? [...spec.dvMods, { source: MATRIX_SOURCE, value: -MOD_STEP, reason: "三段序列全部解开" }]
      : spec.dvMods;
  return { ...spec, bonuses, dvMods };
}

/** 模型写的加成和减值：只写来源和理由，每项一档，数由代码给 */
const ProposalModifierSchema = z.object({
  source: z.string().min(1).describe("来源：本事、义体、物品、穿搭、踩点、痛脚、偷袭、环境……"),
  reason: z.string().min(1),
  pool: BonusPoolKindSchema.optional(),
});
/** 模型写的难度修正：只写方向和理由，每项一档 */
const ProposalDvModSchema = z.object({
  dir: z.enum(["harder", "easier"]).describe("harder 更难，easier 更容易"),
  reason: z.string().min(1),
});
const oneStep = (m: z.infer<typeof ProposalModifierSchema>): Modifier => ({
  ...m,
  value: MOD_STEP,
});

/** 叙事模型提出的 check：只写对手档位和上下沿，不写难度值；代码查表换成 CheckSpec */
export const CheckProposalSchema = CheckSpecSchema.omit({
  dv: true,
  bonuses: true,
  penalties: true,
  dvMods: true,
})
  .extend({
    edge: EdgeSchema.default("low").describe(
      "low 档位基础 DV（T1=8, T2=11, T3=14, T4=18），high 上沿 +1；难度值由代码查表",
    ),
    bonuses: z
      .array(ProposalModifierSchema)
      .default([])
      .describe(`加成：每项 +${MOD_STEP}（硬件池上限 +3，战术池上限 +4），只写来源和理由`),
    penalties: z
      .array(ProposalModifierSchema)
      .default([])
      .describe(`减值：每项 −${MOD_STEP}，只写来源和理由`),
    dvMods: z
      .array(ProposalDvModSchema)
      .default([])
      .describe(`基础值之上的难度修正：每项 ${MOD_STEP}，只写方向和理由`),
  })
  .transform(
    ({ edge, bonuses, penalties, dvMods, ...rest }): CheckSpec => ({
      ...rest,
      dv: baseDv(rest.tier, edge),
      bonuses: bonuses.map(oneStep),
      penalties: penalties.map(oneStep),
      dvMods: dvMods.map(({ dir, reason }) => ({
        source: "situation",
        value: dir === "harder" ? MOD_STEP : -MOD_STEP,
        reason,
      })),
    }),
  );

type ModifierKey = "bonuses" | "penalties" | "dvMods";

function legacyModifier(key: ModifierKey, m: unknown): unknown[] {
  if (typeof m !== "object" || m === null || !("value" in m)) return [m];
  const { value, ...rest } = m as Record<string, unknown>;
  if (typeof value !== "number" || value === 0) return [];
  const n = Math.max(1, Math.min(4, Math.round(Math.abs(value) / MOD_STEP)));
  const one =
    key === "dvMods" ? { dir: value > 0 ? "harder" : "easier", reason: rest.reason } : rest;
  return Array.from({ length: n }, () => one);
}

/** 兼容模型写了数字 dv 或带 value 的修正项 */
export function legacyDvToEdge(raw: unknown): {
  readonly value: unknown;
  readonly note: string | undefined;
} {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { value: raw, note: undefined };
  }
  const notes: string[] = [];
  let out = raw as Record<string, unknown>;
  if ("dv" in out) {
    const { dv, ...rest } = out;
    const tier = TierSchema.safeParse(rest.tier);
    if (rest.edge !== undefined) {
      out = rest;
      notes.push("检定写了难度值数字，按写的上下沿处理，数字不用");
    } else if (typeof dv === "number" && tier.success) {
      const [low, high] = OPPONENT_TIERS[tier.data].dv;
      const edge: Edge = Math.abs(dv - low) <= Math.abs(dv - high) ? "low" : "high";
      out = { ...rest, edge };
      notes.push(`检定写了难度值数字，已按最近的${edge === "low" ? "下沿" : "上沿"}处理`);
    }
  }
  let stepped = false;
  for (const key of ["bonuses", "penalties", "dvMods"] as const) {
    const list = out[key];
    if (!Array.isArray(list)) continue;
    if (!list.some((m) => typeof m === "object" && m !== null && "value" in m)) continue;
    out = { ...out, [key]: list.flatMap((m) => legacyModifier(key, m)) };
    stepped = true;
  }
  if (stepped) notes.push(`检定的加成、减值写了数字，已按每项一档（${MOD_STEP}）换算`);
  return { value: out, note: notes.length > 0 ? notes.join("；") : undefined };
}

export const DiceStateSchema = z.object({
  mode: DifficultySchema,
});
export type DiceState = z.infer<typeof DiceStateSchema>;
