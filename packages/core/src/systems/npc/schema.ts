import { z } from "zod";
import { DamageTierSchema } from "../dice";
// biome-ignore lint/style/noRestrictedImports: health 入口经 inventory 反向加载本文件；定义结构时只读取独立 schema，避免初始化循环。
import { BodyPartSchema, ConditionSchema, InjurySchema } from "../health/schema";
import { NeuralSymptomSchema } from "../humanity";

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
/** 主板/自定义旧识尚未出场定型前的占位前缀（prompt 与 view 共用识别） */
export const NPC_UNDECIDED_PREFIX = "还没定：";
/** 人物卡基础文本字段长度与样本上限 */
export const NAME_CHARS = 20;
export const ROLE_CHARS = 40;
export const LOOK_CHARS = 200;
/** 穿着一句的长度上限 */
export const OUTFIT_CHARS = 120;
export const VOICE_CHARS = 200;
export const SAMPLE_CHARS = 120;
export const NPC_SAMPLES_MAX = 4;
export const WANT_CHARS = 160;
export const LIMIT_CHARS = 160;
export const SECRET_CHARS = 160;

const NpcIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, "人物 id 用小写英文、数字和连字符，例如 rebecca");

/** 装备与植入物记录上限。 */
export const NPC_GEAR_MAX = 6;
export const NPC_CHROME_MAX = 8;
/** 具体装备、义体与已确认的初始症状，不含阶层、HP 或人性点数。 */
export const NpcBodyCardSchema = z
  .object({
    gear: z
      .array(z.string().min(1))
      .max(NPC_GEAR_MAX)
      .default([])
      .describe("实际随身衣物与武器的稳定 id；按用途、财力和已定事实选型，来自已登记物品定义"),
    cyberware: z
      .array(z.string().min(1))
      .max(NPC_CHROME_MAX)
      .default([])
      .describe("按职业用途、来源与部位容量选择的表内义体 id；可无植入，不默认只填基础义眼"),
    symptoms: z.array(NeuralSymptomSchema.omit({ at: true })).optional(),
  })
  .superRefine((b, ctx) => {
    if (new Set(b.gear).size !== b.gear.length)
      ctx.addIssue({ code: "custom", message: "装备栏里有重复物品" });
    if (new Set(b.cyberware).size !== b.cyberware.length)
      ctx.addIssue({ code: "custom", message: "义体里有重复项" });
  });
export type NpcBodyCard = z.infer<typeof NpcBodyCardSchema>;

/** 人物卡里写定以后不改的部分；canon 是原作人物，预先写在 content 包里 */
export const NpcCardSchema = z.object({
  id: NpcIdSchema,
  name: z.string().trim().min(1).max(NAME_CHARS),
  alias: z
    .string()
    .trim()
    .min(1)
    .max(NAME_CHARS)
    .optional()
    .describe("外号或简称（如老维、蝎子、小刀）；没有或还不知道可不写"),
  /** 他、她、TA */
  pronoun: z.string().trim().min(1).max(4).describe("代词：他、她、TA"),
  /** 身份，例如中间人、义体医生、漩涡帮打手 */
  role: z
    .string()
    .trim()
    .min(1)
    .max(ROLE_CHARS)
    .describe("具体身份或行当，例如「漩涡帮改枪匠」「虎爪帮外围收账人」「独立情报掮客」"),
  /**
   * 所属势力（用户 2026-10-31："感觉好没存在感 npc加个所属势力 没有就填无"）：势力表里的 id，
   * 不属于任何势力写 none，档案里显示「无」；旧存档和没写的按 none。id 在不在势力表里由结算校验
   */
  faction: z
    .string()
    .trim()
    .min(1)
    .default(NO_FACTION)
    .describe(
      "所属势力：势力 id（和 faction 指令一致，如 maelstrom、tyger-claws、arasaka）；无势力写 none",
    ),
  /**
   * 长相：不会随换衣服变的部分（身材、发型、脸、纹身、义体、伤疤）。
   * 用户定的（2026-11-02，"长相 + 当前穿着"）：衣着拆到 outfit；旧卡没拆时 look 里还带着衣着，照旧能用
   */
  look: z
    .string()
    .trim()
    .min(1)
    .max(LOOK_CHARS)
    .describe(
      "不会随换衣变的体貌：身形骨架、年龄质感、发型疤痕、纹身、外露义体或小习惯动作，至少 2–3 个具体记忆点",
    ),
  /** 开局穿着：衣服、随身带的显眼东西；换装后以存档里的 wearing 为准。旧卡没有 */
  outfit: z
    .string()
    .trim()
    .min(1)
    .max(OUTFIT_CHARS)
    .optional()
    .describe("现在穿什么：上衣、裤鞋、徽章饰物、明面挎着的枪或工具包；别混进 look"),
  /** 说话方式：口癖、语气、爱用的词 */
  voice: z
    .string()
    .trim()
    .min(1)
    .max(VOICE_CHARS)
    .describe("说话方式：语速停顿、音色腔调、口癖黑话、社交面具与被踩痛处时的语气变化"),
  /** 几句说话样本，只给模型参考口吻，不照搬 */
  samples: z
    .array(z.string().trim().min(1).max(SAMPLE_CHARS))
    .max(NPC_SAMPLES_MAX)
    .default([])
    .describe("1–3 句符合身份的示范台词，只定口吻不照搬（正文说过原话优先收录，不足按性格补齐）"),
  /** 诉求：这个人想要什么 */
  want: z
    .string()
    .trim()
    .min(1)
    .max(WANT_CHARS)
    .describe(
      "具体诉求或当下图谋（写明想从谁手里拿什么、要保谁或脱身什么，别只写「赚钱」「活下去」）",
    ),
  /** 底线：这个人绝不会做、也不能容忍的事 */
  limit: z
    .string()
    .trim()
    .min(1)
    .max(LIMIT_CHARS)
    .describe("绝不跨越的底线或逆鳞（具体到人、规矩或一碰就翻脸的事）"),
  /** 秘密：真实动机、隐藏身份或计划；只有模型看得到 */
  secret: z
    .string()
    .trim()
    .min(1)
    .max(SECRET_CHARS)
    .optional()
    .describe(
      "暗中瞒着的事、私下交易或致命软肋（只给叙事模型在幕后把握，不直接透给玩家；关键/常驻人物尽量写一条）",
    ),
  /** 常在的地点 id */
  home: z
    .string()
    .min(1)
    .optional()
    .describe(
      "常驻地点 id（有固定店面/据点/常混的街区地标时填表内地点 id 或当前 location；流动作战可不写）",
    ),
  canon: z.boolean().default(false),
  /** 身体：随身装备、义体、开局人性；不写按空身补 */
  body: NpcBodyCardSchema.optional().describe(
    "随身武装与义体：gear（物品表 id，含武器与衣物）、cyberware（义体表 id）；不写属性点或档位",
  ),
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

/**
 * 3.0 NPC 三维关系向量（-100 ~ +100）：
 * - trust【信任】：是否愿意把后背交给你、对你说真话
 * - leverage【把柄/依附】：正数代表你捏着他的死穴或他有求于你；负数代表你欠他命债或把柄在他手里
 * - respect【敬畏】：对你的行事手腕、凶名与实力的忌惮程度
 */
export const NpcVectorsSchema = z.object({
  trust: z.number().int().min(-100).max(100).default(0),
  leverage: z.number().int().min(-100).max(100).default(0),
  respect: z.number().int().min(-100).max(100).default(0),
});
export type NpcVectors = z.infer<typeof NpcVectorsSchema>;

/** 路人轻量种子（SeedTag）：二次交集或主动深交时升格为正式 NPC 卡 */
export const SeedTagSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  location: z.string().min(1).nullable().default(null),
  encounters: z.number().int().min(1).default(1),
  note: z.string().min(1),
});
export type SeedTag = z.infer<typeof SeedTagSchema>;

const BaseNpcSchema = NpcCardSchema.extend({
  affinity: z.number().int().min(AFFINITY_MIN).max(AFFINITY_MAX),
  /** 历史存档兼容字段 */
  vectors: NpcVectorsSchema.optional(),
  /** 自走人生目标进度与当前面临的危机 */
  goalProgress: z.number().int().min(0).max(4).optional(),
  crisis: z.string().min(1).nullable().optional(),
  alive: z.boolean(),
  /** 玩家角色见过没有；原作人物开局就有卡，但还没见过 */
  met: z.boolean(),
  /** 世界中的实际地点；场外移动也会更新，不能直接作为玩家已知位置。 */
  location: z.string().min(1).nullable(),
  /** 玩家最后确认的地点；只有正式见面或公开近况提供地点时更新。 */
  lastKnownLocation: z.string().min(1).nullable().default(null),
  /** 最后一次出场的游戏时间（分钟） */
  lastSeenAt: z.number().int().nullable(),
  /** 和玩家角色的共同记忆，旧的在前 */
  memories: z.array(z.string()),
  /** 最近在做什么（只给模型看）：一句话和记下的游戏时间；旧存档没有 */
  doing: z
    .object({ text: z.string().min(1), at: z.number().int() })
    .nullable()
    .default(null),
  /** 正文或消息中已经透露给玩家的近况，独立于幕后行动。 */
  knownDoing: z
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
  /** 换过装以后现在穿的（npcOutfit 写的）和换装的游戏时间；没换过是 null，按卡上的 outfit。旧存档没有 */
  wearing: z
    .object({ text: z.string().min(1).max(OUTFIT_CHARS), at: z.number().int() })
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
  /** 已经发生的身体与神经事实；可惰性计算已治疗创口的恢复。 */
  vitals: z
    .object({
      condition: ConditionSchema,
      nextInjuryId: z.number().int().min(1).default(1),
      hurtAt: z.number().int().nullable(),
      scannedAt: z.number().int().nullable(),
      injuries: z.array(InjurySchema.omit({ source: true })).default([]),
      symptoms: z.array(NeuralSymptomSchema).default([]),
    })
    .nullable()
    .default(null),
});
export const NpcSchema = BaseNpcSchema;
export type Npc = z.infer<typeof NpcSchema>;
export type NpcVitals = NonNullable<Npc["vitals"]>;
export type NpcInjury = NpcVitals["injuries"][number];

export const NpcStateSchema = z.object({
  npcs: z.record(z.string(), NpcSchema),
  /** 街头偶遇的轻量路人种子（二次重逢时升格为正式 NPC 卡） */
  seedTags: z.record(z.string(), SeedTagSchema).optional(),
});
export type NpcState = z.infer<typeof NpcStateSchema>;

const LocationSchema = z.string().min(1).describe("地点 id，和 world 指令用的一致");

/** 模型使用：剧情里新认识、有实质互动或推动剧情的人，当场建卡；没名字先用称呼（用户定的 2026-10-30：在场块一直只有朱迪） */
export const NewNpcSchema = NpcCardSchema.omit({ canon: true })
  .extend({
    type: z.literal("npc"),
    location: LocationSchema.optional(),
  })
  .describe(
    "新人物建卡：和玩家角色有了实质互动（交谈、交易、冲突、人情）或推动剧情（递货、接头、对暗号、要玩家角色跟着走、开口谈条件）就建；正文没给名字时 name 用正文里的称呼（例如「兜帽男」）。擦肩路人不建。look、outfit、voice、samples、want、limit、secret 与 body 要趁这一笔立完整，别建成空壳「普通人」",
  );
export type NewNpc = z.infer<typeof NewNpcSchema>;

/** 模型使用：补全或定型非原作人物卡（如主板/自定义旧识首次正式出场时替掉「还没定」，或补充瘦弱新卡细节） */
export const NpcUpdateSchema = z
  .object({
    type: z.literal("npcUpdate"),
    id: NpcIdSchema,
    alias: NpcCardSchema.shape.alias,
    role: NpcCardSchema.shape.role.optional(),
    faction: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("所属势力：势力 id；不属于任何势力写 none"),
    look: NpcCardSchema.shape.look.optional(),
    outfit: NpcCardSchema.shape.outfit,
    voice: NpcCardSchema.shape.voice.optional(),
    samples: z
      .array(z.string().trim().min(1).max(SAMPLE_CHARS))
      .max(NPC_SAMPLES_MAX)
      .optional()
      .describe("补入的示范台词 1–3 句，只用来定口吻"),
    want: NpcCardSchema.shape.want.optional(),
    limit: NpcCardSchema.shape.limit.optional(),
    secret: NpcCardSchema.shape.secret,
    home: NpcCardSchema.shape.home,
    body: NpcBodyCardSchema.optional(),
  })
  .describe(
    "补全或定型非原作人物卡：用于「还没定」的旧识首次正式出场，或给先前建得很简略的非原作人物补写长相、现在穿、说话方式与样本、诉求底线秘密、常驻地与体格装备义体；原作人物核心卡面固定，不用这条",
  );
export type NpcUpdate = z.infer<typeof NpcUpdateSchema>;

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
    /**
     * NPC 会移动（用户 2026-11-02："npc是能移动的"）：这段时间他去了别处，写现在在的地点 id；
     * 没挪地方不写。场外推演由代码核对地点 id 必须存在
     */
    location: LocationSchema.optional().describe(
      "可省：他这段时间去了别处时写现在在的地点 id；没挪地方不写",
    ),
  })
  .describe(
    "这个人最近在做什么（换了活、搬去哪、在忙什么、和谁走得近）；一句话，只写正文里透出来的（本人说的、新闻、传闻、消息），会替换掉旧的；人换了地方时写 location",
  );
export type Doing = z.infer<typeof DoingSchema>;

/** 场外推演的真实行动：只更新世界状态，不向玩家公开位置或近况。 */
export const NpcOffscreenDoingSchema = DoingSchema.extend({
  type: z.literal("npc.offscreenDoing"),
});
export type NpcOffscreenDoing = z.infer<typeof NpcOffscreenDoingSchema>;

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

/** 模型使用：有卡的人换了衣服（用户定的，2026-11-02："长相 + 当前穿着"） */
export const NpcOutfitSchema = z
  .object({
    type: z.literal("npcOutfit"),
    id: NpcIdSchema,
    text: z.string().trim().min(1).max(OUTFIT_CHARS),
  })
  .describe(
    "有卡的人换了穿着（换上潜水服、穿了正装赴宴、衣服被打烂换了一件）：一句话写现在穿什么，会替换卡上的「现在穿」；长相不变，不写进来",
  );
export type NpcOutfit = z.infer<typeof NpcOutfitSchema>;

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
    part: BodyPartSchema.optional().describe(
      "受伤部位（head、face、chest、belly、left-arm、right-arm、left-leg、right-leg 之一），打中哪就写哪",
    ),
    tier: DamageTierSchema.describe("graze 擦伤，heavy 重伤，lethal 致命；和玩家的伤害档一样"),
    reason: z.string().trim().min(1).max(80).describe("具体怎么伤的、用了什么家伙"),
  })
  .describe(
    "有卡的人受了伤（打斗里中枪挨刀、出事故）：写明 part 部位、tier 档位和 reason 致伤经过；记入具体伤势明细；伤势已经综合装备防护与实际击中位置，不再重复减伤。致命伤需急救，死亡另写 npcDeath",
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
  .describe(
    "有卡的人得到真实治疗：rest 仅休整不清空创口；maxdoc 缓解不适；ripperdoc 稳定伤势并开始恢复，重伤不会随切场自动好",
  );
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
    `有卡的人装上或拆掉一件义体；最多 ${NPC_CHROME_MAX} 件，每个部位按格数装（额叶皮质、神经系统、循环系统、皮肤、骨骼 3 件，眼部、手部 2 件，操作系统、手臂、腿部 1 件；网络接入仓、斯安威斯坦、狂暴都占操作系统，只能装一个），部位装满了再装会换下这个部位最早装的那件；安装本身不自动生成神经症状。玩家角色出钱装的，同时写 money 扣钱`,
  );
export type NpcChrome = z.infer<typeof NpcChromeSchema>;

export const NpcHumanitySchema = z
  .object({
    type: z.literal("npcHumanity"),
    id: NpcIdSchema,
    action: z.enum(["affect", "recover"]),
    symptomId: z.string().min(1),
    stage: z.enum(["detached", "unstable", "edge", "crisis"]).optional(),
    symptom: z.string().min(1).optional(),
    reason: z.string().trim().min(1).max(160),
  })
  .superRefine((c, ctx) => {
    if (c.action === "affect" && (!c.stage || !c.symptom))
      ctx.addIssue({ code: "custom", message: "affect 要写实际 symptom 和 stage" });
  })
  .describe(
    "记录有卡人物实际的神经症状与诱因，或恢复已有症状；symptomId 稳定不变，不能按义体数量或道德行为扣分",
  );
export type NpcHumanity = z.infer<typeof NpcHumanitySchema>;

export const NpcScanSchema = z
  .object({
    type: z.literal("npcScan"),
    id: NpcIdSchema,
  })
  .describe(
    "玩家角色用义眼扫描了有卡的人（打斗里扫描有卡敌人也写这条）：之后人物档案能看到他的身体状况、装备、显眼的义体和人性阶段",
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
  | NpcUpdate
  | Meet
  | Affinity
  | Memory
  | NpcDeath
  | Doing
  | Relation
  | NpcOutfit
  | Tie
  | Ledger
  | LedgerSettle;

function normalizeTextField(
  obj: Record<string, unknown>,
  key: string,
  maxLen: number,
  optional: boolean,
): boolean {
  const val = obj[key];
  if (val === undefined) return false;
  if (typeof val !== "string") return false;
  const trimmed = val.trim();
  if (trimmed === "" && optional) {
    delete obj[key];
    return true;
  }
  const sliced = trimmed.slice(0, maxLen).trimEnd();
  if (sliced !== val) {
    obj[key] = sliced;
    return true;
  }
  return false;
}

/** 运行期对模型发出的 npc / npcUpdate 做温和规整（修小超长、非法字符 id、去重与剥离旧版冗余字段） */
export function normalizeNpcProposal(
  raw: Readonly<Record<string, unknown>>,
): { readonly value: Record<string, unknown>; readonly note: string } | undefined {
  const out: Record<string, unknown> = { ...raw };
  let changed = false;

  if (typeof out.id === "string") {
    const cleanId = out.id
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (cleanId !== "" && cleanId !== out.id) {
      out.id = cleanId;
      changed = true;
    }
  }
  if (raw.type === "npc" && (typeof out.pronoun !== "string" || out.pronoun.trim() === "")) {
    out.pronoun = "TA";
    changed = true;
  }

  for (const [key, max, opt] of [
    ["name", NAME_CHARS, false],
    ["alias", NAME_CHARS, true],
    ["pronoun", 4, false],
    ["role", ROLE_CHARS, false],
    ["look", LOOK_CHARS, false],
    ["outfit", OUTFIT_CHARS, true],
    ["voice", VOICE_CHARS, false],
    ["want", WANT_CHARS, false],
    ["limit", LIMIT_CHARS, false],
    ["secret", SECRET_CHARS, true],
  ] as const) {
    if (normalizeTextField(out, key, max, opt)) changed = true;
  }

  if (out.samples !== undefined) {
    const listRaw = typeof out.samples === "string" ? [out.samples] : out.samples;
    if (Array.isArray(listRaw)) {
      const cleaned = [
        ...new Set(
          listRaw
            .filter((s): s is string => typeof s === "string")
            .map((s) => s.trim().slice(0, SAMPLE_CHARS).trimEnd())
            .filter((s) => s !== ""),
        ),
      ].slice(0, NPC_SAMPLES_MAX);
      if (
        typeof out.samples === "string" ||
        cleaned.length !== listRaw.length ||
        cleaned.some((s, i) => s !== listRaw[i])
      ) {
        out.samples = cleaned;
        changed = true;
      }
    }
  }

  if (typeof out.body === "object" && out.body !== null && !Array.isArray(out.body)) {
    const body = { ...(out.body as Record<string, unknown>) };
    let bodyChanged = false;
    for (const [k, cap] of [
      ["gear", NPC_GEAR_MAX],
      ["cyberware", NPC_CHROME_MAX],
    ] as const) {
      const arr = body[k];
      if (Array.isArray(arr)) {
        const list = [
          ...new Set(
            arr
              .filter((x): x is string => typeof x === "string")
              .map((x) => x.trim())
              .filter((x) => x !== ""),
          ),
        ].slice(0, cap);
        if (list.length !== arr.length || list.some((x, i) => x !== arr[i])) {
          body[k] = list;
          bodyChanged = true;
        }
      }
    }
    if ("tier" in body) {
      delete body.tier;
      bodyChanged = true;
    }
    if ("attributes" in body) {
      delete body.attributes;
      bodyChanged = true;
    }
    if (bodyChanged) {
      out.body = body;
      changed = true;
    }
  }

  return changed ? { value: out, note: "人物卡字段已按长度与去重规则微调" } : undefined;
}

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

export const NpcConditionSchema = z.object({
  type: z.literal("npc.condition"),
  id: NpcIdSchema,
  condition: z.enum(["up", "down"]),
  reason: z.string().min(1),
});
export type NpcCondition = z.infer<typeof NpcConditionSchema>;
export type NpcInternal =
  | SeedNpc
  | NpcMemoryEdit
  | NpcPast
  | NpcOffscreenDeath
  | NpcOffscreenDoing
  | NpcCondition;
