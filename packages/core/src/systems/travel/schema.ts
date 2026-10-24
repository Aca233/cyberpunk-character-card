import { z } from "zod";

/** 出行方式：不做快速移动，路线面板只给这几种 */
export const TravelModeSchema = z.enum(["walk", "metro", "taxi", "car", "stolen"]);
export type TravelMode = z.infer<typeof TravelModeSchema>;

export const TRAVEL_MODE_LABELS: Readonly<Record<TravelMode, string>> = {
  walk: "步行",
  metro: "NCART 轻轨",
  taxi: "Delamain 出租车",
  car: "自己的车",
  stolen: "偷来的车",
};

export const RiskSchema = z.enum(["low", "medium", "high"]);
export type Risk = z.infer<typeof RiskSchema>;
export const RISK_LABELS: Readonly<Record<Risk, string>> = { low: "低", medium: "中", high: "高" };

/** 路上偶遇的素材；数据在 content 包的 encounters.ts */
export const EncounterDefSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  /** 给叙事模型的一句话：碰上了什么，玩家不理会怎样 */
  note: z.string().min(1),
  /** 只在这些城区出现；不写是全城 */
  districts: z.array(z.string().min(1)).min(1).optional(),
  /** 只在这些时段出现；不写是全天 */
  periods: z
    .array(z.enum(["dawn", "day", "dusk", "night"]))
    .min(1)
    .optional(),
  /** 通缉星至少这么多才出现 */
  minHeat: z.number().min(0).max(5).optional(),
  /** 街头声望至少这么多才出现 */
  minCred: z.number().int().min(0).optional(),
  /** 只在这些出行方式上出现 */
  modes: z.array(TravelModeSchema).min(1).optional(),
  /** 抽中的权重 1–5 */
  weight: z.number().int().min(1).max(5).default(1),
});
export type EncounterDef = z.infer<typeof EncounterDefSchema>;
export const EncounterCatalogSchema = z.array(EncounterDefSchema);

/** 这一场抽中的偶遇；场景结束清掉 */
export const EncounterSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  note: z.string().min(1),
  district: z.string().min(1),
  at: z.number().int(),
});
export type Encounter = z.infer<typeof EncounterSchema>;

export const TripSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  mode: TravelModeSchema,
  minutes: z.number().int().min(1),
  cost: z.number().int().min(0),
  at: z.number().int(),
  encounter: z.string().min(1).nullable(),
});
export type Trip = z.infer<typeof TripSchema>;

/** 留几条出行记录 */
export const TRIPS_KEPT = 10;

export const TravelStateSchema = z.object({
  trips: z.array(TripSchema),
  /** 上一次偶遇在第几个场景；一个场景最多一次 */
  encounterScene: z.number().int().nullable(),
  encounter: EncounterSchema.nullable(),
});
export type TravelState = z.infer<typeof TravelStateSchema>;

/** 只能由代码发出：玩家在路线面板确认的出行 */
export const TravelCommandSchema = z
  .object({
    type: z.literal("travel"),
    to: z.string().min(1),
    mode: TravelModeSchema,
  })
  .describe("按路线面板出行（只能由代码发出）：推进时间、扣路费、换地点、定路上的偶遇");
export type TravelCommand = z.infer<typeof TravelCommandSchema>;

/** 网页路线面板提交的出行 */
export const TravelRequestSchema = z.strictObject({
  to: z.string().min(1),
  mode: TravelModeSchema,
});
export type TravelRequest = z.infer<typeof TravelRequestSchema>;

/** 写正文前定下的出行，作为本轮事实交给结算 */
export const TravelFactSchema = z.object({
  to: z.string().min(1),
  mode: TravelModeSchema,
  encounter: z.string().min(1).nullable(),
});
export type TravelFact = z.infer<typeof TravelFactSchema>;

/** 偶遇频率：设置里调，每轮随请求带上 */
export const EncounterPaceSchema = z.enum(["off", "rare", "normal", "often"]);
export type EncounterPace = z.infer<typeof EncounterPaceSchema>;
export const ENCOUNTER_PACE_FACTORS: Readonly<Record<EncounterPace, number>> = {
  off: 0,
  rare: 0.5,
  normal: 1,
  often: 1.5,
};
