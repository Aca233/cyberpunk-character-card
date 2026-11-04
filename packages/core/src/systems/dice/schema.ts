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

/** 叙事模型返回的 check：掷骰前先说清成功和失败会怎样 */
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
  /** 抵抗某次快速破解时在掷骰前绑定来源，不能用对手或失败描述猜测 */
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
  /**
   * 和有卡的人对抗（躲他、骗他、和他对打、破他的防）时写他的卡 id（用户 2026-11-02 选的"对抗时提高难度"）：
   * 他装着利于这项属性的义体时，代码在记下检定前把难度提高一档，不用另写 dvMods
   */
  opponent: z
    .string()
    .min(1)
    .optional()
    .describe(
      "和有卡的人对抗时写他的卡 id（潜行躲他、骗他、和他对打）；他的义体利于这项属性时代码自动加一档难度，不用另写",
    ),
});
export type CheckSpec = z.infer<typeof CheckSpecSchema>;

/** 对手义体加的难度修正的来源；同一个检定只加一次 */
export const OPPONENT_CHROME_SOURCE = "对手义体";

/**
 * 对手义体利于这项属性时难度提高一档（MOD_STEP）：favors 是他身上利于 spec.attribute 的义体名字。
 * 没写 opponent、没有利于的义体、或者已经加过时原样返回
 */
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

/** 上下沿：low 取对手档位的下限（偏容易），high 取上限（偏难） */
export const EdgeSchema = z.enum(["low", "high"]);
export type Edge = z.infer<typeof EdgeSchema>;

/** 难度值的基础值：对手档位加上下沿查表 */
export function baseDv(tier: Tier, edge: Edge): number {
  return OPPONENT_TIERS[tier].dv[edge === "low" ? 0 : 1];
}

/** 加成和减值的一档：本事、义体、先机、断肢、起疑都是一档；提示词里的数都从这里来 */
export const MOD_STEP = 2;

/** 入侵协议矩阵小游戏最多解开几段序列 */
export const MATRIX_MAX = 3;
const MATRIX_SOURCE = "入侵协议矩阵";

/**
 * 设置里开了矩阵小游戏时，完成情况换算成检定修正（本作改编）：前两段各加一档，三段全解开再降一档难度。
 * 只对智力检定算；没玩或一段没解开时原样返回
 */
export function withMatrix(spec: CheckSpec, solved: number | undefined): CheckSpec {
  if (solved === undefined || solved < 1 || spec.attribute !== "intelligence") return spec;
  const n = Math.min(Math.floor(solved), MATRIX_MAX);
  const bonuses = [...spec.bonuses];
  for (let i = 1; i <= Math.min(n, 2); i++) {
    bonuses.push({ source: MATRIX_SOURCE, value: MOD_STEP, reason: `解开第 ${i} 段序列` });
  }
  const dvMods =
    n >= MATRIX_MAX
      ? [...spec.dvMods, { source: MATRIX_SOURCE, value: -MOD_STEP, reason: "三段序列全部解开" }]
      : spec.dvMods;
  return { ...spec, bonuses, dvMods };
}

/** 模型写的加成和减值：只写来源和理由，每项一档，数由代码给 */
const ProposalModifierSchema = z.object({
  source: z.string().min(1).describe("来源：本事、义体、物品、人物、准备、伤势、环境……"),
  reason: z.string().min(1),
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

/** 叙事模型提出的 check：只写对手档位和上下沿，不写难度值；代码查表换成存档里的 CheckSpec */
export const CheckProposalSchema = CheckSpecSchema.omit({
  dv: true,
  bonuses: true,
  penalties: true,
  dvMods: true,
})
  .extend({
    edge: EdgeSchema.describe("low 档位下沿（偏容易），high 上沿（偏难）；难度值由代码查表"),
    bonuses: z
      .array(ProposalModifierSchema)
      .default([])
      .describe(`加成：每项一档 +${MOD_STEP}，只写来源和理由，不写数`),
    penalties: z
      .array(ProposalModifierSchema)
      .default([])
      .describe(`减值：每项一档 −${MOD_STEP}，只写来源和理由，不写数`),
    dvMods: z
      .array(ProposalDvModSchema)
      .default([])
      .describe(`基础值之上的难度修正：每项一档 ${MOD_STEP}，只写方向和理由`),
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

/** 旧格式的一项修正（带 value）换成若干档：按 value 除以一档取最近的整数，至少一档；0 或不是数的丢掉 */
function legacyModifier(key: ModifierKey, m: unknown): unknown[] {
  if (typeof m !== "object" || m === null || !("value" in m)) return [m];
  const { value, ...rest } = m as Record<string, unknown>;
  if (typeof value !== "number" || value === 0) return [];
  const n = Math.max(1, Math.round(Math.abs(value) / MOD_STEP));
  const one =
    key === "dvMods" ? { dir: value > 0 ? "harder" : "easier", reason: rest.reason } : rest;
  return Array.from({ length: n }, () => one);
}

/**
 * 模型仍写了数字难度值时：换成最近的上下沿（一样近取下沿），数字不用；已经写了 edge 就只去掉数字。
 * 加成、减值、难度修正写了 value 时按每项一档换算。返回换过的对象和一句提示，没写数字时提示为 undefined
 */
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

export const DiceStateSchema = z.object({ mode: DifficultySchema });
export type DiceState = z.infer<typeof DiceStateSchema>;
