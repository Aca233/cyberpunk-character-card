import { z } from "zod";

export const HEAT_MAX = 5;
/** 自然下降的间隔：从最后一次被人看见算起，每满一个游戏日降一星 */
export const HEAT_DECAY_MINUTES = 1440;
/** 贿赂每降一星的价钱 = 这个数 × 当前星级（暂定） */
export const BRIBE_PER_STAR = 1000;
/** 最近事件留几条 */
export const RECENT_EVENTS = 10;

/** 事件类别：叙事模型只报告发生了什么，声望和热度由代码推导 */
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

export const HeatEventSchema = z.object({
  at: z.number().int(),
  kind: EventKindSchema,
  /** 这一条让热度涨了多少星，可以是 0 */
  delta: z.number(),
  reason: z.string(),
});
export type HeatEvent = z.infer<typeof HeatEventSchema>;

/** 4 星以上的暴力大案留下悬赏（原作依据 2.0 的通缉系统；金额本作改编） */
export const BOUNTY_MIN_STARS = 4;
/** 悬赏金额 = 这个数 × 当时的星级；再犯大案每次加一份 */
export const BOUNTY_PER_STAR = 2500;
/** 一份悬赏最多记几条案由 */
export const BOUNTY_REASONS = 5;

/** 了结悬赏的办法：摆平、顶罪、伪造死亡、离开城区避一阵（本作改编） */
export const BOUNTY_RESOLUTIONS = ["settled", "scapegoat", "fakeDeath", "leftTown"] as const;
export const BountyResolutionSchema = z.enum(BOUNTY_RESOLUTIONS);
export type BountyResolution = z.infer<typeof BountyResolutionSchema>;
export const BOUNTY_RESOLUTION_LABELS: Readonly<Record<BountyResolution, string>> = {
  settled: "摆平了",
  scapegoat: "有人顶了罪",
  fakeDeath: "伪造了死亡",
  leftTown: "离开城区避了一阵",
};

export const BountySchema = z.object({
  id: z.string().min(1),
  at: z.number().int(),
  reward: z.number().int().min(0),
  reasons: z.array(z.string()).max(BOUNTY_REASONS),
  /** 追你的赏金猎人（人物 id）；还没建卡时为 null */
  hunter: z.string().nullable(),
  resolvedAt: z.number().int().nullable(),
  resolution: BountyResolutionSchema.nullable(),
});
export type Bounty = z.infer<typeof BountySchema>;

export const HeatStateSchema = z.object({
  /** 警方热度 0–5 星；旧存档里可能有半星，界面和提示词显示整星 */
  stars: z.number().min(0).max(HEAT_MAX).multipleOf(0.5),
  /** 最后一次被人看见（目击、摄像头、盘查）的游戏时间；自然下降从这里起算 */
  lastSeenAt: z.number().int().nullable(),
  /** 自然下降已经算到的时间 */
  decayedAt: z.number().int().nullable(),
  /** 上次在哪个城区；换了城区当天多降一星 */
  district: z.string().nullable(),
  /** 上次因为换城区多降一星是第几个游戏日 */
  districtDay: z.number().int().nullable(),
  /** 上次因为躲在自己的安全屋多降一星是第几个游戏日；旧存档没有 */
  hideoutDay: z.number().int().nullable().default(null),
  recent: z.array(HeatEventSchema).max(RECENT_EVENTS),
  /** 警方播报用独立递增编号，旧记录滚出列表不改变剩余消息的 id */
  nextNotice: z.number().int().min(1).default(1),
  /** 只记实际显示星级的上升；事件的理论增量不代表封顶后仍然涨星 */
  notices: z
    .array(
      z
        .object({
          id: z.number().int().min(1),
          at: z.number().int(),
          before: z.number().int().min(0).max(HEAT_MAX),
          after: z.number().int().min(0).max(HEAT_MAX),
        })
        .refine((n) => n.after > n.before, {
          message: "警方播报必须对应实际显示星级的上升",
        }),
    )
    .max(RECENT_EVENTS)
    .default([]),
  /** 悬赏：不随时间消失，只能靠剧情了结 */
  bounties: z.array(BountySchema).default([]),
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
    /** 有人报了警：没人看见也照样涨 */
    reportedTo: z.literal("ncpd").optional(),
    reason: z.string().min(1),
  })
  .describe(
    "事件：只报告发生了什么，热度和声望由代码推导。kind 从固定列表里选；witnesses 是看见的人数（没人看见、也没被拍到写 0）；public 是不是在公开场合；有人报了警写 reportedTo: ncpd",
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

/** 模型使用：{"type": "bounty", "action": "hunter", "npc": "...", "reason": "..."} */
export const BountyCommandSchema = z
  .object({
    type: z.literal("bounty"),
    action: z.enum(["hunter", "resolve"]),
    /** 悬赏 id；只有一份没了结的时可以不写 */
    id: z.string().min(1).optional(),
    /** hunter：赏金猎人的人物 id（先写 npc 建卡） */
    npc: z.string().min(1).optional(),
    /** resolve：怎么了结的 */
    how: BountyResolutionSchema.optional(),
    reason: z.string().trim().min(1).max(80),
  })
  .refine((c) => c.action !== "hunter" || c.npc !== undefined, {
    message: "hunter 要写 npc（赏金猎人的人物 id）",
    path: ["npc"],
  })
  .refine((c) => c.action !== "resolve" || c.how !== undefined, {
    message: "resolve 要写 how（settled、scapegoat、fakeDeath、leftTown）",
    path: ["how"],
  })
  .describe(
    "悬赏：悬赏由代码在大案后生成。hunter 是赏金猎人登场了，npc 写他的人物 id（先用 npc 建卡）；resolve 是靠剧情了结了，how 写 settled 摆平、scapegoat 有人顶罪、fakeDeath 伪造死亡、leftTown 离开城区避风头",
  );
export type BountyCommand = z.infer<typeof BountyCommandSchema>;

/** 只能由代码发出：帮 NCPD 办了事，热度降一星（悬赏不受影响） */
export const HeatReliefSchema = z.object({
  type: z.literal("heat.relief"),
  reason: z.string().min(1),
});
export type HeatRelief = z.infer<typeof HeatReliefSchema>;
