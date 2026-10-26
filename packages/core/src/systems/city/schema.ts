import { z } from "zod";

/** 记下的动静最多留这么多条，先删已经结束的 */
export const CITY_KEPT = 30;
/** 收场时离上次场外推演隔了这么多场，或者游戏时间过了这么多小时，就再推演一次 */
export const OFFSCREEN_SCENES = 3;
export const OFFSCREEN_HOURS = 12;
/** 一次推演最多写几条动静、其中最多几条头条 */
export const OFFSCREEN_EVENTS = 3;
export const OFFSCREEN_MAJOR = 1;
/** 传闻最多留这么多条，旧的先删；一次推演最多写几条 */
export const RUMORS_KEPT = 12;
export const OFFSCREEN_RUMORS = 3;
/** 新闻快讯和电台插段最多留这么多段，一段最长这么多字 */
export const BULLETINS_KEPT = 20;
export const BULLETIN_MAX = 200;
/** 隔这么多小时代码才再挑一次该主动联系玩家的人；一次最多挑几个 */
export const CONTACT_HOURS = 24;
export const CONTACT_PICKS = 2;
/** 一次推演最多让几个原作人物死在屏幕外 */
export const OFFSCREEN_DEATHS = 1;

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

/** 传闻和真相差多少：属实、夸大、走样 */
export const RumorTruthSchema = z.enum(["true", "exaggerated", "garbled"]);
export type RumorTruth = z.infer<typeof RumorTruthSchema>;
export const RUMOR_TRUTH_LABELS: Readonly<Record<RumorTruth, string>> = {
  true: "属实",
  exaggerated: "夸大",
  garbled: "走样",
};
/** 传多远：一条街、一个城区、全城 */
export const RumorReachSchema = z.enum(["street", "district", "city"]);
export type RumorReach = z.infer<typeof RumorReachSchema>;
export const RUMOR_REACH_LABELS: Readonly<Record<RumorReach, string>> = {
  street: "一条街在传",
  district: "整个城区在传",
  city: "全城都在传",
};

/** 场外推演写的一条传闻（不带时间） */
export const RumorFieldsSchema = z.object({
  /** 说的是哪件动静；可省 */
  event: CityEventIdSchema.optional(),
  /** 街上传的原话 */
  text: z.string().trim().min(1).max(80),
  truth: RumorTruthSchema,
  reach: RumorReachSchema,
  /** 城区：reach 不是 city 时写在哪一带传 */
  district: z.string().trim().min(1).max(20).optional(),
  /** 说的是玩家角色 */
  player: z.boolean().default(false),
});
export const RumorSchema = RumorFieldsSchema.extend({ at: z.number().int() });
export type Rumor = z.infer<typeof RumorSchema>;

export const BulletinKindSchema = z.enum(["news", "radio"]);
export type BulletinKind = z.infer<typeof BulletinKindSchema>;
export const BULLETIN_KIND_LABELS: Readonly<Record<BulletinKind, string>> = {
  news: "N54 快讯",
  radio: "电台",
};
/** 场外推演写的一段新闻快讯或电台主持词：公司口径，引用的是传开的版本 */
export const BulletinFieldsSchema = z.object({
  kind: BulletinKindSchema,
  title: z.string().trim().min(1).max(24),
  text: z.string().trim().min(1).max(BULLETIN_MAX),
});
export const BulletinSchema = BulletinFieldsSchema.extend({
  id: z.number().int().min(1),
  at: z.number().int(),
});
export type Bulletin = z.infer<typeof BulletinSchema>;

/** 城里的动静：玩家没看着的地方在发生的事，只给模型看；新闻快讯玩家在侧栏看得到 */
export const CityStateSchema = z.object({
  events: z.array(CityEventSchema).default([]),
  /** 街头传闻，旧的在前，最多 RUMORS_KEPT 条；只给模型看 */
  rumors: z.array(RumorSchema).default([]),
  /** 新闻快讯和电台插段，旧的在前，最多 BULLETINS_KEPT 条 */
  bulletins: z.array(BulletinSchema).default([]),
  nextBulletin: z.number().int().min(1).default(1),
  /** 上次场外推演时是第几场、游戏时间几点；还没推演过为 null */
  lastScene: z.number().int().nullable().default(null),
  lastAt: z.number().int().nullable().default(null),
  /** 上次代码挑人主动联系玩家的游戏时间；还没挑过为 null */
  lastContactAt: z.number().int().nullable().default(null),
});
export type CityState = z.infer<typeof CityStateSchema>;

/** 只能由代码发出：场外推演写的一条动静 */
export const CityEventCommandSchema = CityEventFieldsSchema.extend({
  type: z.literal("city.event"),
});
export type CityEventCommand = z.infer<typeof CityEventCommandSchema>;

/** 只能由代码发出：场外推演写的一条传闻 */
export const CityRumorCommandSchema = RumorFieldsSchema.extend({
  type: z.literal("city.rumor"),
});
export type CityRumorCommand = z.infer<typeof CityRumorCommandSchema>;

/** 只能由代码发出：场外推演写的一段新闻快讯或电台主持词 */
export const CityBulletinCommandSchema = BulletinFieldsSchema.extend({
  type: z.literal("city.bulletin"),
});
export type CityBulletinCommand = z.infer<typeof CityBulletinCommandSchema>;

/** 只能由代码发出：记下这次场外推演的场次和时间；contact 为真时这次挑过该主动联系的人 */
export const CityRanSchema = z.object({
  type: z.literal("city.ran"),
  contact: z.boolean().optional(),
});

export type CityInternal =
  | CityEventCommand
  | CityRumorCommand
  | CityBulletinCommand
  | z.infer<typeof CityRanSchema>;
