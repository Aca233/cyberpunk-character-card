import { z } from "zod";

export const HEAT_MAX = 5;
/** 自然下降的间隔：从最后一次被人看见算起，每满一个游戏日降一星 */
export const HEAT_DECAY_MINUTES = 1440;
/** 贿赂每降一星的价钱 = 这个数 × 当前星级（暂定） */
export const BRIBE_PER_STAR = 1000;
/** 最近事件留几条 */
export const RECENT_EVENTS = 10;

/** 事件类别：主持人只报告发生了什么，声望和热度由代码推导 */
export const EVENT_KINDS = [
  "kill",
  "publicViolence",
  "theft",
  "vandalism",
  "publicHack",
  "humiliate",
  "betray",
  "rescue",
  "help",
] as const;
export const EventKindSchema = z.enum(EVENT_KINDS);
export type EventKind = z.infer<typeof EventKindSchema>;

export const EVENT_LABELS: Readonly<Record<EventKind, string>> = {
  kill: "杀人",
  publicViolence: "公开动手",
  theft: "偷窃",
  vandalism: "破坏财产",
  publicHack: "骇入公共网络",
  humiliate: "羞辱",
  betray: "背叛",
  rescue: "救人",
  help: "帮忙",
};

/** 地点的性质：公司产区里犯事只算公司的账，帮派地盘里只有公开暴力才惊动 NCPD */
export const ZoneSchema = z.enum(["street", "gang", "corp"]);
export type Zone = z.infer<typeof ZoneSchema>;

/** 城区警力：强的热度涨得快，弱的减半，none 是 NCPD 不管的地方（热度不涨） */
export type PoliceStrength = "strong" | "normal" | "weak" | "none";

/** 按城区中文名查警力，照策划书：市中心和西区强，太平洲弱，恶土和狗镇不管；表里没有的按一般算 */
export const DISTRICT_POLICE: Readonly<Record<string, PoliceStrength>> = {
  市中心: "strong",
  威斯特布鲁克: "strong",
  沃森: "normal",
  海伍德: "normal",
  圣多明各: "normal",
  太平洲: "weak",
  恶土: "none",
  狗镇: "none",
};

export const HeatEventSchema = z.object({
  at: z.number().int(),
  kind: EventKindSchema,
  /** 这一条让热度涨了多少星，可以是 0 */
  delta: z.number(),
  reason: z.string(),
});
export type HeatEvent = z.infer<typeof HeatEventSchema>;

export const HeatStateSchema = z.object({
  /** 警方热度 0–5 星，按半星记：警力弱的城区增量减半；界面和提示词显示整星 */
  stars: z.number().min(0).max(HEAT_MAX).multipleOf(0.5),
  /** 最后一次被人看见（目击、摄像头、盘查）的游戏时间；自然下降从这里起算 */
  lastSeenAt: z.number().int().nullable(),
  /** 自然下降已经算到的时间 */
  decayedAt: z.number().int().nullable(),
  /** 上次在哪个城区；换了城区当天多降一星 */
  district: z.string().nullable(),
  /** 上次因为换城区多降一星是第几个游戏日 */
  districtDay: z.number().int().nullable(),
  recent: z.array(HeatEventSchema).max(RECENT_EVENTS),
});
export type HeatState = z.infer<typeof HeatStateSchema>;

/** 模型使用：{"type": "event", "kind": "kill", "witnesses": 3, "public": true, "reason": "..."} */
export const EventCommandSchema = z
  .object({
    type: z.literal("event"),
    kind: EventKindSchema,
    /** 对谁做的：人物 id、势力或一句话 */
    target: z.string().min(1).optional(),
    witnesses: z.number().int().min(0).max(1000),
    public: z.boolean(),
    /** 公司或帮派报了警：不管在哪里，都按大街上犯事算 */
    reportedTo: z.literal("ncpd").optional(),
    reason: z.string().min(1),
  })
  .describe(
    "事件：只报告发生了什么，热度和声望由代码按地点推导。kind 从固定列表里选；witnesses 是看见的人数（没人看见、也没被拍到写 0）；public 是不是在公开场合；公司或帮派报了警写 reportedTo: ncpd",
  );
export type EventCommand = z.infer<typeof EventCommandSchema>;

/** 模型使用：{"type": "heat", "action": "bribe", "reason": "..."} */
export const HeatCommandSchema = z
  .object({
    type: z.literal("heat"),
    action: z.enum(["bribe", "seen"]),
    reason: z.string().min(1),
  })
  .describe(
    "警方热度：bribe 是贿赂警察成功，降一星，代码按星级扣欧元（5 星不能贿赂）；seen 是被摄像头或盘查看见但没犯新事，自然下降重新计时",
  );
export type HeatCommand = z.infer<typeof HeatCommandSchema>;
