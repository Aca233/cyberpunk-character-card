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
  /** 这次驾驶实际使用的车辆；其他出行方式不写。 */
  vehicle: z.string().min(1).optional(),
  minutes: z.number().int().min(1),
  cost: z.number().int().min(0),
  at: z.number().int(),
  encounter: z.string().min(1).nullable(),
});
export type Trip = z.infer<typeof TripSchema>;

/** 留几条出行记录 */
export const TRIPS_KEPT = 10;

/** 只能由代码发出：玩家在路线面板确认的出行 */
export const TravelCommandSchema = z
  .object({
    type: z.literal("travel"),
    to: z.string().min(1),
    mode: TravelModeSchema,
    vehicle: z.string().min(1).optional(),
  })
  .describe("按路线面板出行（只能由代码发出）：推进时间、扣路费、换地点、定路上的偶遇");
export type TravelCommand = z.infer<typeof TravelCommandSchema>;

/** 网页路线面板提交的出行 */
export const TravelRequestSchema = z.strictObject({
  to: z.string().min(1),
  mode: TravelModeSchema,
  vehicle: z.string().min(1).optional(),
});
export type TravelRequest = z.infer<typeof TravelRequestSchema>;

/** 写正文前定下的出行，作为本轮事实交给结算 */
export const TravelFactSchema = z.object({
  to: z.string().min(1),
  mode: TravelModeSchema,
  vehicle: z.string().min(1).optional(),
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

/** 载具分类照原作：经济型、行政型、运动型、超跑、越野、摩托 */
export const VehicleClassSchema = z.enum([
  "economy",
  "executive",
  "sport",
  "hyper",
  "offroad",
  "moto",
]);
export type VehicleClass = z.infer<typeof VehicleClassSchema>;
export const VEHICLE_CLASS_LABELS: Readonly<Record<VehicleClass, string>> = {
  economy: "经济型",
  executive: "行政型",
  sport: "运动型",
  hyper: "超跑",
  offroad: "越野",
  moto: "摩托",
};

/** 车型表的一条；数据在 content 包的 vehicles.ts */
export const VehicleDefSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** 厂牌 */
  maker: z.string().min(1).optional(),
  class: VehicleClassSchema,
  /** 速度档 1–5：开车出行的耗时按它折算 */
  speed: z.number().int().min(1).max(5),
  seats: z.number().int().min(1).max(8),
  price: z.number().int().min(1000).max(100_000),
  note: z.string().min(1).optional(),
});
export type VehicleDef = z.infer<typeof VehicleDefSchema>;
export const VehicleCatalogSchema = z.array(VehicleDefSchema);

export const VehicleConditionSchema = z.enum(["intact", "damaged", "wrecked"]);
export type VehicleCondition = z.infer<typeof VehicleConditionSchema>;
export const VEHICLE_CONDITION_LABELS: Readonly<Record<VehicleCondition, string>> = {
  intact: "完好",
  damaged: "受损",
  wrecked: "报废",
};

/** 名下的一辆车 */
export const OwnedVehicleSchema = z.object({
  /** 这辆车的 id，例如 thorton-galena-1 */
  id: z.string().min(1),
  model: z.string().min(1),
  condition: VehicleConditionSchema,
  /** 车辆实际停放位置；驾驶出行时由代码同步到目的地。 */
  location: z.string().nullable(),
  /** 偷来的：开着它风险高，迟早要扔 */
  stolen: z.boolean(),
  /** 已弃车：不再作为日常座驾，但留在世界原处（含车内留置物品）供后续世界演化 */
  abandoned: z.boolean().default(false),
  since: z.number().int(),
});
export type OwnedVehicle = z.infer<typeof OwnedVehicleSchema>;

/** 修车按车价的这个比例收钱（本作改编） */
export const REPAIR_SHARE = 0.1;

/** 模型使用：{"type": "vehicle", "action": "steal", "model": "thorton-galena", "witnesses": 0, "reason": "..."} */
export const VehicleCommandSchema = z
  .object({
    type: z.literal("vehicle"),
    action: z.enum(["buy", "steal", "damage", "repair", "wreck", "abandon", "chase"]),
    /** buy、steal 写车型 id */
    model: z.string().min(1).optional(),
    /** 对哪辆车；相关现场只有一辆候选车时可以省略，多辆须明确。 */
    vehicle: z.string().min(1).optional(),
    /** damage/wreck 发生在远处时写车辆所在地点；不得用来远程修车或追逐。 */
    location: z.string().min(1).optional(),
    /** steal：看见的人数 */
    witnesses: z.number().int().min(0).max(1000).optional(),
    /** chase：事先说好的失败代价——damage 车受损，stopped 被拦下，heat 通缉星涨 */
    stake: z.enum(["damage", "stopped", "heat"]).optional(),
    reason: z.string().min(1),
  })
  .superRefine((c, ctx) => {
    if ((c.action === "buy" || c.action === "steal") && c.model === undefined)
      ctx.addIssue({
        code: "custom",
        path: ["model"],
        message: "buy 和 steal 要写 model（车型 id）",
      });
    if (c.action === "chase" && c.stake === undefined)
      ctx.addIssue({ code: "custom", path: ["stake"], message: "chase 要写 stake（失败的代价）" });
  })
  .describe(
    "载具：buy 买车；steal 偷车；damage/wreck 记录车辆实际受损，远处发生时标明地点；repair、chase 只能操作身边车辆；abandon 可随时丢下车辆（车内留有物品或证据时连车带物留下并继续承受后果）；同一现场多辆候选车必须明确 vehicle",
  );
export type VehicleCommand = z.infer<typeof VehicleCommandSchema>;

/** 开局送的车（只能由代码发出） */
export const VehicleGrantSchema = z.object({
  type: z.literal("vehicle.grant"),
  model: z.string().min(1),
  reason: z.string().min(1),
});
export type VehicleGrant = z.infer<typeof VehicleGrantSchema>;

export const TravelStateSchema = z.object({
  trips: z.array(TripSchema),
  /** 上一次偶遇在第几个场景；一个场景最多一次 */
  encounterScene: z.number().int().nullable(),
  encounter: EncounterSchema.nullable(),
  /** 名下的车 */
  vehicles: z.array(OwnedVehicleSchema),
  /** 单调递增的实车编号。 */
  nextVehicleId: z.number().int().min(1),
});
export type TravelState = z.infer<typeof TravelStateSchema>;
