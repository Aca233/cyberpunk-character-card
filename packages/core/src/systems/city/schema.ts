import { z } from "zod";

/** 记下的动静最多留这么多条，先删已经结束的 */
export const CITY_KEPT = 30;
/** 收场时离上次场外推演隔了这么多场，或者游戏时间过了这么多小时，就再推演一次 */
export const OFFSCREEN_SCENES = 3;
export const OFFSCREEN_HOURS = 12;
/** 一次推演最多写几条动静、其中最多几条头条 */
export const OFFSCREEN_EVENTS = 3;
export const OFFSCREEN_MAJOR = 1;

export const CityStatusSchema = z.enum(["brewing", "heating", "cooling", "over"]);
export type CityStatus = z.infer<typeof CityStatusSchema>;
export const CITY_STATUS_LABELS: Readonly<Record<CityStatus, string>> = {
  brewing: "在酝酿",
  heating: "在升级",
  cooling: "在平息",
  over: "结束了",
};

/** minor 街角小事，normal 几个街区在传，major 上了 N54 头条、会找到玩家头上 */
export const CityWeightSchema = z.enum(["minor", "normal", "major"]);
export type CityWeight = z.infer<typeof CityWeightSchema>;

export const CityEventIdSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "id 用小写英文、数字和连字符，最长 40");

/** 模型写的一条动静；已有的 id 整条替换 */
export const CityEventFieldsSchema = z.object({
  id: CityEventIdSchema,
  title: z.string().trim().min(1).max(24),
  body: z.string().trim().min(1).max(160),
  district: z.string().trim().min(1).max(20).optional(),
  status: CityStatusSchema,
  weight: CityWeightSchema,
});

export const CityEventSchema = CityEventFieldsSchema.extend({
  startedAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type CityEvent = z.infer<typeof CityEventSchema>;

/** 城里的动静：玩家没看着的地方在发生的事，只给模型看 */
export const CityStateSchema = z.object({
  events: z.array(CityEventSchema).default([]),
  /** 上次场外推演时是第几场、游戏时间几点；还没推演过为 null */
  lastScene: z.number().int().nullable().default(null),
  lastAt: z.number().int().nullable().default(null),
});
export type CityState = z.infer<typeof CityStateSchema>;

/** 只能由代码发出：场外推演写的一条动静 */
export const CityEventCommandSchema = CityEventFieldsSchema.extend({
  type: z.literal("city.event"),
});
export type CityEventCommand = z.infer<typeof CityEventCommandSchema>;

/** 只能由代码发出：记下这次场外推演的场次和时间 */
export const CityRanSchema = z.object({ type: z.literal("city.ran") });

export type CityInternal = CityEventCommand | z.infer<typeof CityRanSchema>;
