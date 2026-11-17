import { z } from "zod";

/** 输了之后多久才肯再比（分钟） */
export const REMATCH_MINUTES = 1440;

export const GigKindSchema = z.enum(["fight", "race"]);
export type GigKind = z.infer<typeof GigKindSchema>;
export const GIG_KIND_LABELS: Readonly<Record<GigKind, string>> = { fight: "拳赛", race: "赛车" };

/** 对手成色与威望：不对应 T1–T4 骰点表，仅用于提示对手斤两 */
export const OpponentTierSchema = z.enum(["street", "veteran", "elite", "legend"]);
export type OpponentTier = z.infer<typeof OpponentTierSchema>;

export const OPPONENT_TIER_LABELS: Readonly<Record<OpponentTier, string>> = {
  street: "街头",
  veteran: "老手",
  elite: "精英",
  legend: "传奇",
};

/** 一场拳赛或赛车：对手打赢一次就不再比。数据在 content 包的 sidegigs.ts */
export const GigDefSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  kind: GigKindSchema,
  name: z.string().min(1).max(24),
  opponent: z.string().min(1).max(20),
  /** 地点表里的 id */
  location: z.string().min(1),
  tier: OpponentTierSchema,
  /** 报名押金 */
  stake: z.number().int().min(0).max(20_000),
  /** 赢了拿多少 */
  purse: z.number().int().min(0).max(100_000),
  note: z.string().min(1).max(120),
  source: z.string().min(1),
});
export type GigDef = z.infer<typeof GigDefSchema>;
export const GigCatalogSchema = z.array(GigDefSchema);

export const GigRecordSchema = z.object({
  wins: z.number().int().min(0).default(0),
  losses: z.number().int().min(0).default(0),
  lastAt: z.number().int().nullable().default(null),
});

export const SidegigsStateSchema = z.object({
  /** 正在比的一场 */
  active: z
    .object({ gig: z.string().min(1), at: z.number().int(), vehicle: z.string().min(1).optional() })
    .nullable()
    .default(null),
  /** 每场的战绩：gig id → 胜负 */
  record: z.record(z.string(), GigRecordSchema).default({}),
});
export type SidegigsState = z.infer<typeof SidegigsStateSchema>;

/** 模型使用：报名、赢、输、中途不比 */
export const SidegigCommandSchema = z
  .object({
    type: z.literal("sidegig"),
    action: z.enum(["enter", "win", "lose", "quit"]),
    id: z.string().min(1),
    /** 赛车现场只有一辆可用车可省略；多辆时明确本场参赛车。 */
    vehicle: z.string().min(1).optional(),
    reason: z.string().trim().min(1).max(80).optional(),
  })
  .describe(
    "拳赛和赛车：enter 报名（代码扣押金，要人在那里；赛车要有未报废车辆在场，多辆时明确 vehicle）；按现场实力、状态与临场条件裁决胜负，赢了写 win（代码付奖金、加声望），输了写 lose；中途不比写 quit，押金不退",
  );
export type SidegigCommand = z.infer<typeof SidegigCommandSchema>;
