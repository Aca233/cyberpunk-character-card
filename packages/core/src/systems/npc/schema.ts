import { z } from "zod";
import { DamageTierSchema } from "../dice";

/** 人物卡上「不属于任何势力」的写法，档案里显示「无」（用户 2026-10-31："没有就填无"） */
export const NO_FACTION = "none";
export const NO_FACTION_LABEL = "无";

export const AFFINITY_MIN = -100;
export const AFFINITY_MAX = 100;
/** 单条好感变化的上限，超出的截断 */
export const AFFINITY_STEP_CAP = 10;
/** 每个人物保留最近这么多条共同记忆 */
export const MEMORY_KEPT = 12;
/** 人物经历时间线最多留这么多条；到了 TIMELINE_SQUASH 条场外推演就该压成摘要，超过上限时代码直接删最早的 */
export const TIMELINE_KEPT = 8;
export const TIMELINE_SQUASH = 6;
/** 压成摘要以后经历只留最近这么多条 */
export const TIMELINE_TAIL = 3;
/** 经历摘要最长这么多字 */
export const PAST_MAX = 160;

const NpcIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, "人物 id 用小写英文、数字和连字符，例如 rebecca");

/**
 * 人物的档位：mook 普通人、pro 老手、elite 精英、legend 传奇（本作改编）。
 * 决定属性总和的范围、没写属性时的默认值、算生命上限时当作多少街头声望
 */
export const NpcTierSchema = z.enum(["mook", "pro", "elite", "legend"]);
export type NpcTier = z.infer<typeof NpcTierSchema>;
export const NPC_TIER_LABELS: Readonly<Record<NpcTier, string>> = {
  mook: "普通人",
  pro: "老手",
  elite: "精英",
  legend: "传奇",
};
/** 五项属性（不算义体加成）加起来的范围，建卡时代码校验（暂定，试玩时调） */
export const NPC_TIER_ATTR_SUM: Readonly<Record<NpcTier, readonly [number, number]>> = {
  mook: [15, 35],
  pro: [25, 50],
  elite: [40, 70],
  legend: [55, 100],
};
/** 没写属性时每项的默认值 */
export const NPC_TIER_DEFAULT_ATTR: Readonly<Record<NpcTier, number>> = {
  mook: 5,
  pro: 7,
  elite: 10,
  legend: 13,
};
/** 算生命上限时当作的街头声望 */
export const NPC_TIER_CRED: Readonly<Record<NpcTier, number>> = {
  mook: 0,
  pro: 10,
  elite: 25,
  legend: 40,
};
export const NPC_ATTR_MIN = 3;
export const NPC_ATTR_MAX = 20;
/** 装备栏最多几件、义体最多几件 */
export const NPC_GEAR_MAX = 6;
export const NPC_CHROME_MAX = 8;

const NpcAttrValueSchema = z.number().int().min(NPC_ATTR_MIN).max(NPC_ATTR_MAX);
/** 和玩家同一套五项属性 */
export const NpcAttributesSchema = z.object({
  body: NpcAttrValueSchema,
  reflexes: NpcAttrValueSchema,
  tech: NpcAttrValueSchema,
  intelligence: NpcAttrValueSchema,
  cool: NpcAttrValueSchema,
});
export type NpcAttributes = z.infer<typeof NpcAttributesSchema>;

function attrSum(a: NpcAttributes): number {
  return a.body + a.reflexes + a.tech + a.intelligence + a.cool;
}

/**
 * 人物卡上的身体：档位、属性、装备栏（物品表 id）、义体（义体表 id）、开局人性。
 * id 在不在表里要拿内容数据才能查，由结算校验；这里只查范围和重复
 */
export const NpcBodyCardSchema = z
  .object({
    tier: NpcTierSchema.describe("mook 普通人，pro 老手，elite 精英，legend 传奇；按身份选"),
    attributes: NpcAttributesSchema.optional().describe(
      `五项属性 ${NPC_ATTR_MIN}–${NPC_ATTR_MAX}，不算义体加成；不写按档位给默认值`,
    ),
    gear: z
      .array(z.string().min(1))
      .max(NPC_GEAR_MAX)
      .default([])
      .describe("装备栏：物品表里的 id，手里的武器和身上的衣服"),
    cyberware: z
      .array(z.string().min(1))
      .max(NPC_CHROME_MAX)
      .default([])
      .describe("装着的义体：义体表里的 id"),
    humanity: z
      .number()
      .int()
      .min(0)
      .max(100)
      .optional()
      .describe("开局人性；不写按 100 减去义体消耗"),
  })
  .superRefine((b, ctx) => {
    if (b.attributes) {
      const sum = attrSum(b.attributes);
      const [lo, hi] = NPC_TIER_ATTR_SUM[b.tier];
      if (sum < lo || sum > hi) {
        ctx.addIssue({
          code: "custom",
          message: `${NPC_TIER_LABELS[b.tier]}的五项属性加起来要在 ${lo}–${hi}，现在是 ${sum}`,
        });
      }
    }
    if (new Set(b.gear).size !== b.gear.length) {
      ctx.addIssue({ code: "custom", message: "装备栏里有重复的物品" });
    }
    if (new Set(b.cyberware).size !== b.cyberware.length) {
      ctx.addIssue({ code: "custom", message: "义体里有重复的" });
    }
  });
export type NpcBodyCard = z.infer<typeof NpcBodyCardSchema>;

/** 人物卡里写定以后不改的部分；canon 是原作人物，预先写在 content 包里 */
export const NpcCardSchema = z.object({
  id: NpcIdSchema,
  name: z.string().trim().min(1).max(20),
  alias: z.string().trim().min(1).max(20).optional(),
  /** 他、她、TA */
  pronoun: z.string().trim().min(1).max(4),
  /** 身份，例如中间人、义体医生、漩涡帮打手 */
  role: z.string().trim().min(1).max(40),
  /**
   * 所属势力（用户 2026-10-31："感觉好没存在感 npc加个所属势力 没有就填无"）：势力表里的 id，
   * 不属于任何势力写 none，档案里显示「无」；旧存档和没写的按 none。id 在不在势力表里由结算校验
   */
  faction: z
    .string()
    .trim()
    .min(1)
    .default(NO_FACTION)
    .describe("所属势力：势力 id（和 faction 指令用的一致）；不属于任何势力写 none"),
  look: z.string().trim().min(1).max(200),
  /** 说话方式：口癖、语气、爱用的词 */
  voice: z.string().trim().min(1).max(200),
  /** 几句说话样本，只给模型参考口吻，不照搬 */
  samples: z.array(z.string().trim().min(1).max(120)).max(4).default([]),
  /** 诉求：这个人想要什么 */
  want: z.string().trim().min(1).max(160),
  /** 底线：这个人绝不会做、也不能容忍的事 */
  limit: z.string().trim().min(1).max(160),
  /** 秘密：真实动机、隐藏身份或计划；只有模型看得到 */
  secret: z.string().trim().min(1).max(160).optional(),
  /** 常在的地点 id */
  home: z.string().min(1).optional(),
  canon: z.boolean().default(false),
  /** 身体：档位、属性、装备、义体、开局人性；不写按普通人的默认值补 */
  body: NpcBodyCardSchema.optional(),
});
export type NpcCard = z.infer<typeof NpcCardSchema>;

/** 每个人物最多留这么多条人情和仇，满了先删最早了结的，再删最早的 */
export const LEDGER_KEPT = 12;
/** 关系笔记一句的长度上限 */
export const RELATION_CHARS = 60;

/** owesYou 对方欠你人情，youOwe 你欠对方人情，grudge 对方记你的仇 */
export const LedgerKindSchema = z.enum(["owesYou", "youOwe", "grudge"]);
export type LedgerKind = z.infer<typeof LedgerKindSchema>;
export const LEDGER_KIND_LABELS: Readonly<Record<LedgerKind, string>> = {
  owesYou: "欠你人情",
  youOwe: "你欠人情",
  grudge: "记你的仇",
};

export const LedgerEntrySchema = z.object({
  kind: LedgerKindSchema,
  text: z.string().min(1).max(80),
  /** 记下的游戏时间 */
  at: z.number().int(),
  /** 了结（还了、报了、放下了）的游戏时间；没了结是 null */
  settledAt: z.number().int().nullable(),
  /** 怎么了结的 */
  how: z.string().min(1).max(60).optional(),
});
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;

/** 每个人物最多记这么多条玩家角色知道的事，满了先删最早的 */
export const KNOWN_KEPT = 12;

/** 玩家角色怎么知道的：seen 亲眼看到，self 本人说的，told 别人说的，rumor 传闻，scan 扫描 */
export const KnownSourceSchema = z.enum(["seen", "self", "told", "rumor", "scan"]);
export type KnownSource = z.infer<typeof KnownSourceSchema>;
export const KNOWN_SOURCE_LABELS: Readonly<Record<KnownSource, string>> = {
  seen: "亲眼见",
  self: "本人说",
  told: "别人说",
  rumor: "传闻",
  scan: "扫描",
};

export const KnownFactSchema = z.object({
  text: z.string().min(1).max(80),
  source: KnownSourceSchema,
  at: z.number().int(),
});
export type KnownFact = z.infer<typeof KnownFactSchema>;

/** 每个人最多记这么多个认识的人，满了先删最早的（暂定，试玩时调） */
export const TIES_KEPT = 8;
/** 认识的人的关系一句的长度上限 */
export const TIE_CHARS = 40;

/** 一个人认识的另一个有卡的人：对方 id、一句关系（从这个人的角度写）、外人看不看得出来 */
export const NpcTieSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1).max(TIE_CHARS),
  open: z.boolean().default(true),
  at: z.number().int(),
});
export type NpcTie = z.infer<typeof NpcTieSchema>;

export const NpcSchema = NpcCardSchema.extend({
  affinity: z.number().int().min(AFFINITY_MIN).max(AFFINITY_MAX),
  alive: z.boolean(),
  /** 玩家角色见过没有；原作人物开局就有卡，但还没见过 */
  met: z.boolean(),
  /** 最后出现的地点 id */
  location: z.string().min(1).nullable(),
  /** 最后一次出场的游戏时间（分钟） */
  lastSeenAt: z.number().int().nullable(),
  /** 和玩家角色的共同记忆，旧的在前 */
  memories: z.array(z.string()),
  /** 最近在做什么（只给模型看）：一句话和记下的游戏时间；旧存档没有 */
  doing: z
    .object({ text: z.string().min(1), at: z.number().int() })
    .nullable()
    .default(null),
  /** 经历时间线（只给模型看）：每次近况变了记一条，旧的在前，最多 TIMELINE_KEPT 条；旧存档没有 */
  timeline: z.array(z.object({ text: z.string().min(1), at: z.number().int() })).default([]),
  /** 更早的经历压成的摘要（只给模型看）；还没压过是 null */
  past: z
    .object({ text: z.string().min(1).max(PAST_MAX), at: z.number().int() })
    .nullable()
    .default(null),
  /** 在玩家没看着的地方死的（场外推演写的）：死因和时间；玩家听说以前人物档案照旧显示活着 */
  offscreenDeath: z
    .object({ cause: z.string().min(1), at: z.number().int() })
    .nullable()
    .default(null),
  /** 关系笔记：叙事模型写的一句关系状态，显示在人物档案里；旧存档没有 */
  relation: z
    .object({ text: z.string().min(1), at: z.number().int() })
    .nullable()
    .default(null),
  /** 人情和仇，旧的在前；了结的留着，标了结时间 */
  ledger: z.array(LedgerEntrySchema).default([]),
  /** 玩家角色知道的这个人的事，旧的在前；人物档案只显示这些；旧存档没有 */
  known: z.array(KnownFactSchema).default([]),
  /**
   * 认识的人（用户 2026-10-31："npc也有自己的生活，也有认识的npc"）：和别的有卡的人的关系，两边各记一份；
   * 旧的在前，最多 TIES_KEPT 条；open 是外人看得出来的关系，暗地里的（私通、卧底、暗中勾结）是 false，只给模型看
   */
  ties: z.array(NpcTieSchema).default([]),
  /**
   * 会变的身体数值：生命值（hp 是 hpAt 那一刻的值，之后按时间惰性回复）、人性数值、最近一次受伤和被扫描的时间。
   * 第一次受伤、治疗、换装备或装义体时按 body 补上；旧存档和没碰过的人是 null。人性数值只给叙事模型
   */
  vitals: z
    .object({
      hp: z.number().int().min(0),
      hpAt: z.number().int(),
      humanity: z.number().int().min(0).max(100),
      hurtAt: z.number().int().nullable(),
      scannedAt: z.number().int().nullable(),
    })
    .nullable()
    .default(null),
});
export type Npc = z.infer<typeof NpcSchema>;
export type NpcVitals = NonNullable<Npc["vitals"]>;

export const NpcStateSchema = z.object({
  npcs: z.record(z.string(), NpcSchema),
});
export type NpcState = z.infer<typeof NpcStateSchema>;

const LocationSchema = z.string().min(1).describe("地点 id，和 world 指令用的一致");

/** 模型使用：剧情里新认识、有实质互动或推动剧情的人，当场建卡；没名字先用称呼（用户定的 2026-10-30：在场块一直只有朱迪） */
export const NewNpcSchema = NpcCardSchema.omit({ canon: true, samples: true, home: true })
  .extend({
    type: z.literal("npc"),
    location: LocationSchema.optional(),
  })
  .describe(
    "新人物建卡：和玩家角色有了实质互动（交谈、交易、冲突、人情）或推动了剧情（递货、接头、对暗号、要玩家角色跟着走）就建；正文没给名字时 name 用正文里的称呼（例如「兜帽男」）。擦肩而过、待在背景里的路人不建。want、limit、secret 写定以后不能改",
  );
export type NewNpc = z.infer<typeof NewNpcSchema>;

/** 模型使用：已有人物出场或换了地点 */
export const MeetSchema = z
  .object({
    type: z.literal("meet"),
    id: NpcIdSchema,
    location: LocationSchema.optional(),
  })
  .describe(
    "已有人物卡的人出场（第一次见面也用这条），或换了地点；id 必须是【人物】里有卡的。没卡的路人（酒保、店员、路过的帮派成员）不写 meet；要和他有实质来往、以后还会出场，先写 npc 建卡",
  );
export type Meet = z.infer<typeof MeetSchema>;

export const AffinitySchema = z
  .object({
    type: z.literal("affinity"),
    id: NpcIdSchema,
    delta: z
      .number()
      .int()
      .refine((v) => v !== 0, "好感变化不能为 0"),
    reason: z.string().trim().min(1).max(80),
  })
  .describe(
    `好感变化（结算用；模型写的是方向和大小，见 AffinityProposalSchema）；单条最多 ±${AFFINITY_STEP_CAP}，范围 ${AFFINITY_MIN} 到 ${AFFINITY_MAX}，代码截断`,
  );
export type Affinity = z.infer<typeof AffinitySchema>;

/** 好感的大小档：小事、帮了忙或伤了感情、救命之恩或背叛；换算表只在这里写一份（暂定，试玩时调） */
export const AFFINITY_SIZES = { small: 2, medium: 5, large: 10 } as const;
export type AffinitySize = keyof typeof AFFINITY_SIZES;
const AFFINITY_SIZE_LABELS: Readonly<Record<AffinitySize, string>> = {
  small: "小",
  medium: "中",
  large: "大",
};

/** 模型写的好感：只选方向和大小，代码按 AFFINITY_SIZES 换成数字 */
export const AffinityProposalSchema = z
  .object({
    type: z.literal("affinity"),
    id: NpcIdSchema,
    dir: z.enum(["up", "down"]).describe("up 态度变好，down 变差"),
    size: z
      .enum(["small", "medium", "large"])
      .describe("small 小事（一句好话、一点冒犯），medium 帮了忙或伤了感情，large 救命之恩或背叛"),
    reason: z.string().trim().min(1).max(80),
  })
  .describe("好感变化：只选方向和大小，不写数字，代码换算并截断")
  .transform(
    ({ dir, size, ...rest }): Affinity => ({
      ...rest,
      delta: (dir === "up" ? 1 : -1) * AFFINITY_SIZES[size],
    }),
  );

/** 模型仍写了数字好感时：换成最近的大小档（一样近取小的），方向看正负 */
export function legacyAffinity(
  raw: Readonly<Record<string, unknown>>,
): { readonly value: Record<string, unknown>; readonly note: string } | undefined {
  if (!("delta" in raw)) return undefined;
  const { delta, ...rest } = raw;
  if (rest.dir !== undefined && rest.size !== undefined) {
    return { value: rest, note: "好感写了数字，按写的方向和大小处理，数字不用" };
  }
  if (typeof delta !== "number" || !Number.isFinite(delta) || delta === 0) return undefined;
  const abs = Math.abs(delta);
  const sizes = Object.entries(AFFINITY_SIZES) as [AffinitySize, number][];
  const [size] = sizes.reduce((best, cur) =>
    Math.abs(cur[1] - abs) < Math.abs(best[1] - abs) ? cur : best,
  );
  return {
    value: { ...rest, dir: delta > 0 ? "up" : "down", size },
    note: `好感写了数字，已按最近的档位（${AFFINITY_SIZE_LABELS[size]}）处理`,
  };
}

export const MemorySchema = z
  .object({
    type: z.literal("memory"),
    id: NpcIdSchema,
    text: z.string().trim().min(1).max(120),
  })
  .describe("记下这个人和玩家角色之间值得记住的事：承诺、人情、冲突、秘密被说破；一句话");
export type Memory = z.infer<typeof MemorySchema>;

export const NpcDeathSchema = z
  .object({
    type: z.literal("npcDeath"),
    id: NpcIdSchema,
    reason: z.string().trim().min(1).max(80),
  })
  .describe("人物死亡；死了的人不会再出场");
export type NpcDeath = z.infer<typeof NpcDeathSchema>;

export const DoingSchema = z
  .object({
    type: z.literal("doing"),
    id: NpcIdSchema,
    text: z.string().trim().min(1).max(80),
  })
  .describe(
    "这个人最近在做什么（换了活、搬去哪、在忙什么、和谁走得近）；一句话，只写正文里透出来的（本人说的、新闻、传闻、消息），会替换掉旧的",
  );
export type Doing = z.infer<typeof DoingSchema>;

export const RelationSchema = z
  .object({
    type: z.literal("relation"),
    id: NpcIdSchema,
    text: z.string().trim().min(1).max(RELATION_CHARS),
  })
  .describe(
    "关系笔记：一句话写这个人和玩家角色现在的关系（例如「信得过，但还没说过真心话」）；一起扛过事、说过真心话、背叛、被拆穿大谎这类关系真的变了才写，会替换掉旧的",
  );
export type Relation = z.infer<typeof RelationSchema>;

/** 模型使用：两个有卡的人之间的关系（用户 2026-10-31："npc也有自己的生活，也有认识的npc"） */
export const TieSchema = z
  .object({
    type: z.literal("tie"),
    a: NpcIdSchema,
    b: NpcIdSchema,
    aToB: z
      .string()
      .trim()
      .min(1)
      .max(TIE_CHARS)
      .describe("从 a 的角度写 b 是谁，例如「老搭档，欠他一条命」「前夫」「上家，供货给他」"),
    bToA: z.string().trim().min(1).max(TIE_CHARS).describe("从 b 的角度写 a 是谁"),
    open: z
      .boolean()
      .default(true)
      .describe("外人看得出来的关系写 true；暗中勾结、私情、卧底这类见不得光的写 false"),
  })
  .describe(
    "两个有卡的人之间的关系：认识、搭档、亲人、旧情、上下家、结仇；正文或场外推演里透出来、或者关系变了才写，会替换两人之间旧的那条；和玩家角色的关系写 relation",
  );
export type Tie = z.infer<typeof TieSchema>;

export const LedgerSchema = z
  .object({
    type: z.literal("ledger"),
    id: NpcIdSchema,
    kind: LedgerKindSchema.describe(
      "owesYou 对方欠玩家角色人情，youOwe 玩家角色欠对方人情，grudge 对方记玩家角色的仇",
    ),
    text: z.string().trim().min(1).max(80),
  })
  .describe("记一笔人情或仇：帮了大忙、救过命、替人扛了事、结下梁子；一句话写清是什么事");
export type Ledger = z.infer<typeof LedgerSchema>;

export const LedgerSettleSchema = z
  .object({
    type: z.literal("ledgerSettle"),
    id: NpcIdSchema,
    entry: z.number().int().min(1).describe("【人物】里这个人的人情和仇的第几条"),
    how: z.string().trim().min(1).max(60),
  })
  .describe("了结一笔人情或仇：还了、报了、放下了；how 一句话写怎么了结的");
export type LedgerSettle = z.infer<typeof LedgerSettleSchema>;

export const LearnSchema = z
  .object({
    type: z.literal("learn"),
    id: NpcIdSchema,
    text: z.string().trim().min(1).max(80),
    source: KnownSourceSchema.describe(
      "seen 玩家角色亲眼看到，self 本人说的，told 别人说的，rumor 传闻、新闻，scan 扫描",
    ),
  })
  .describe(
    "玩家角色得知了有卡的人的一件事（身份、来历、去向、和谁有来往）：正文里真的透出来才写，一句话，写玩家角色以为的样子；对方骗人的话照骗的写，传闻照传的写",
  );
export type Learn = z.infer<typeof LearnSchema>;

export const NpcHurtSchema = z
  .object({
    type: z.literal("npcHurt"),
    id: NpcIdSchema,
    tier: DamageTierSchema.describe("graze 擦伤，heavy 重伤，lethal 致命；和玩家的伤害档一样"),
    reason: z.string().trim().min(1).max(80),
  })
  .describe(
    "有卡的人受了伤（打斗里中枪挨刀、出事故）：按档扣他的生命值，装着护甲义体降一档；打到 0 是倒下，不会自己好，死没死另写 npcDeath",
  );
export type NpcHurt = z.infer<typeof NpcHurtSchema>;

export const NpcHealSchema = z
  .object({
    type: z.literal("npcHeal"),
    id: NpcIdSchema,
    how: z
      .enum(["rest", "maxdoc", "ripperdoc"])
      .describe("rest 休整了一阵，maxdoc 用了治疗品，ripperdoc 找义体医生治好了"),
    reason: z.string().trim().min(1).max(80).optional(),
  })
  .describe("有卡的人得到治疗；倒下（生命 0）的人只有 ripperdoc 能救起来");
export type NpcHeal = z.infer<typeof NpcHealSchema>;

export const NpcGearSchema = z
  .object({
    type: z.literal("npcGear"),
    id: NpcIdSchema,
    action: z.enum(["add", "remove"]),
    item: z.string().min(1).describe("物品表里的 id"),
  })
  .describe(
    `有卡的人的装备栏换了东西：拿到新武器、换衣服、丢了枪；最多 ${NPC_GEAR_MAX} 件。玩家角色给他买的，同时写 money 扣钱`,
  );
export type NpcGear = z.infer<typeof NpcGearSchema>;

export const NpcChromeSchema = z
  .object({
    type: z.literal("npcChrome"),
    id: NpcIdSchema,
    action: z.enum(["install", "remove"]),
    cyberware: z.string().min(1).describe("义体表里的 id"),
  })
  .describe(
    `有卡的人装上或拆掉一件义体；最多 ${NPC_CHROME_MAX} 件，装上会压低他的人性上限。玩家角色出钱装的，同时写 money 扣钱`,
  );
export type NpcChrome = z.infer<typeof NpcChromeSchema>;

export const NpcHumanitySchema = z
  .object({
    type: z.literal("npcHumanity"),
    id: NpcIdSchema,
    kind: z
      .enum(["cruelty", "loss", "rest"])
      .describe(
        "cruelty 他做了残忍的事，loss 他失去了重要的人，rest 他好好休整、和在乎的人待了一阵",
      ),
    size: z.enum(["small", "medium", "large"]),
    reason: z.string().trim().min(1).max(80),
  })
  .describe("有卡的人的人性变化：和玩家角色同一套档位，代码换算；数值只有叙事模型看得到");
export type NpcHumanity = z.infer<typeof NpcHumanitySchema>;

export const NpcScanSchema = z
  .object({
    type: z.literal("npcScan"),
    id: NpcIdSchema,
  })
  .describe(
    "玩家角色用义眼扫描了有卡的人（打斗里扫描有卡敌人也写这条）：之后人物档案能看到他的属性、威胁、生命、显眼的义体和人性阶段",
  );
export type NpcScan = z.infer<typeof NpcScanSchema>;

export type NpcCommand =
  | NpcHurt
  | NpcHeal
  | NpcGear
  | NpcChrome
  | NpcHumanity
  | NpcScan
  | Learn
  | NewNpc
  | Meet
  | Affinity
  | Memory
  | NpcDeath
  | Doing
  | Relation
  | Tie
  | Ledger
  | LedgerSettle;

/** 只能由代码发出：新存档放进原作人物卡和主板模块带出的旧识，开局好感按卡上写的 */
export const SeedNpcSchema = NpcCardSchema.extend({
  type: z.literal("npc.seed"),
  affinity: z.number().int().min(AFFINITY_MIN).max(AFFINITY_MAX).default(0),
  /** 主板带出的人物是角色过去就认识的 */
  met: z.boolean().default(false),
  /**
   * 捏人第 3 步选的旧识关系写成的开局关系笔记（老朋友、前任）；原作人物和旧存档没有。
   * 用户定的（2026-10-30）：旧识"无数个"，关系表里老朋友、前任附带关系笔记
   */
  relation: z.string().trim().min(1).max(RELATION_CHARS).optional(),
  /** 旧识关系附带的开局人情或仇（他欠你人情、你欠他人情、旧仇）；同上，用户定的关系表 */
  ledger: z
    .array(z.object({ kind: LedgerKindSchema, text: z.string().trim().min(1).max(80) }))
    .max(2)
    .default([]),
});
export type SeedNpc = z.infer<typeof SeedNpcSchema>;

/**
 * 只能由代码发出：玩家在记忆面板改写或删掉一条共同记忆。
 * index 是 memories 里的下标，before 是玩家看到的原文，对不上（期间又写了新的）就不改
 */
export const NpcMemoryEditSchema = z.object({
  type: z.literal("npc.memoryEdit"),
  id: NpcIdSchema,
  index: z.number().int().min(0),
  before: z.string().min(1),
  action: z.enum(["edit", "remove"]),
  text: z.string().trim().min(1).max(120).optional(),
});
export type NpcMemoryEdit = z.infer<typeof NpcMemoryEditSchema>;

/** 只能由场外推演产生：把这个人较早的经历压成一段摘要，替换掉旧的摘要，经历只留最近 TIMELINE_TAIL 条 */
export const NpcPastSchema = z.object({
  type: z.literal("npc.past"),
  id: NpcIdSchema,
  text: z.string().trim().min(1).max(PAST_MAX),
});
export type NpcPast = z.infer<typeof NpcPastSchema>;

/** 只能由场外推演产生：原作人物在玩家没看着的地方死了；玩家听说之前人物档案照旧显示活着 */
export const NpcOffscreenDeathSchema = z.object({
  type: z.literal("npc.offscreenDeath"),
  id: NpcIdSchema,
  cause: z.string().trim().min(1).max(80),
});
export type NpcOffscreenDeath = z.infer<typeof NpcOffscreenDeathSchema>;

export type NpcInternal = SeedNpc | NpcMemoryEdit | NpcPast | NpcOffscreenDeath;
