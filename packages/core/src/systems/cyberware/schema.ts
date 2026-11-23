import { z } from "zod";
import { RaritySchema } from "../economy";

/** 义体部位，按原作分类；每个部位能装几件见 SLOT_CAPACITY */
export const CYBERWARE_SLOTS = [
  "frontalCortex",
  "eyes",
  "nervous",
  "os",
  "circulatory",
  "integumentary",
  "skeleton",
  "hands",
  "arms",
  "legs",
] as const;
export const CyberwareSlotSchema = z.enum(CYBERWARE_SLOTS);
export type CyberwareSlot = z.infer<typeof CyberwareSlotSchema>;

export const SLOT_LABELS: Readonly<Record<CyberwareSlot, string>> = {
  frontalCortex: "额叶皮质",
  eyes: "眼部",
  nervous: "神经系统",
  os: "操作系统",
  circulatory: "循环系统",
  integumentary: "皮肤",
  skeleton: "骨骼",
  hands: "手部",
  arms: "手臂",
  legs: "腿部",
};

/**
 * 每个部位能装几件：照原作 2.0 义体医生那一页每组的格数（apps/web 的 CyberDoll.tsx 里 CYBER_SIDES 已经照着画了）。
 * 原来一个部位只装一件，用户 2026-10-31 说"为什么每个地方的义体只能选一个""现在 ui 和能装的义体数量对不上"，改成按格数装
 */
export const SLOT_CAPACITY: Readonly<Record<CyberwareSlot, number>> = {
  frontalCortex: 3,
  eyes: 2,
  nervous: 3,
  os: 1,
  circulatory: 3,
  integumentary: 3,
  skeleton: 3,
  hands: 2,
  arms: 1,
  legs: 1,
};

/** 黑客硬件的定性特化：隐蔽、群控扩散、强攻烧毁、黑墙、网监溯源、防黑冰、散热回复 */
export const DECK_TRAITS = [
  "stealth",
  "spread",
  "combat",
  "blackwall",
  "netwatch",
  "antiIce",
  "recovery",
] as const;
export const DeckTraitSchema = z.enum(DECK_TRAITS);
export type DeckTrait = z.infer<typeof DeckTraitSchema>;

export const DECK_TRAIT_LABELS: Readonly<Record<DeckTrait, string>> = {
  stealth: "隐蔽渗透",
  spread: "群控扩散",
  combat: "强攻烧毁",
  blackwall: "黑墙异质协议",
  netwatch: "网监溯源",
  antiIce: "防黑冰",
  recovery: "散热缓冲",
};

/** 行为芯片统一四态模型（玩家与 NPC 共用）：清醒 / 玩偶托管 / 改装协议 / 芯片异常 */
export const BehaviorChipModeSchema = z.enum(["off", "doll", "protocol", "glitch"]);
export type BehaviorChipMode = z.infer<typeof BehaviorChipModeSchema>;

export const BEHAVIOR_CHIP_MODE_LABELS: Readonly<Record<BehaviorChipMode, string>> = {
  off: "清醒",
  doll: "玩偶托管",
  protocol: "改装协议",
  glitch: "芯片异常",
};

/** 设备本身的固定行为与记忆条件；职业称呼不等于实际安装。 */
export const BehaviorChipProfileSchema = z.object({
  purpose: z.string().trim().min(1).max(160),
  awareness: z.enum(["present", "absent"]).default("absent"),
  recall: z.enum(["retained", "none"]).default("none"),
  logging: z.enum(["none", "local-summary"]).default("local-summary"),
  safeword: z.string().trim().min(1).max(40).optional(),
});
export type BehaviorChipProfile = z.infer<typeof BehaviorChipProfileSchema>;

export const BehaviorChipStateSchema = z.object({
  mode: BehaviorChipModeSchema,
  protocol: z.string().trim().min(1).max(120).nullable().default(null),
  /** 由外置行为协议芯片驱动时记录对应载体 id；现场直刷协议为 null */
  carrier: z.string().min(1).nullable().default(null),
  since: z.number().int(),
  memoryGap: z.boolean().default(false),
  lastControl: z
    .object({
      from: z.number().int(),
      to: z.number().int().nullable(),
      mode: BehaviorChipModeSchema.optional(),
    })
    .optional(),
  /** 日志是设备摘要，不是超梦、亲历记忆或全知客户档案。 */
  logs: z
    .array(
      z.object({
        id: z.string().min(1),
        text: z.string().trim().min(1).max(240),
        at: z.number().int(),
        reviewedAt: z.number().int().nullable(),
      }),
    )
    .default([]),
});
export type BehaviorChipState = z.infer<typeof BehaviorChipStateSchema>;

export const BehaviorChipTermsSchema = z.object({
  device: z.string().min(1).describe("实际已安装的行为芯片型号 id（如 doll-behavior-chip）"),
  action: z.enum(["mode", "log", "review"]),
  mode: BehaviorChipModeSchema.optional().describe(
    "四态切换：off 清醒、doll 玩偶托管、protocol 改装协议、glitch 芯片故障/被骇",
  ),
  protocol: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .optional()
    .describe("mode=protocol 时写入当前刷入的协议名或芯片（如格斗/潜行/情绪屏蔽协议）"),
  carrier: z.string().min(1).optional().describe("可选：驱动该协议的外置行为协议芯片载体 id"),
  log: z.string().min(1).optional().describe("一段实际设备摘要的稳定 id；重复记录不改原文"),
  text: z.string().trim().min(1).max(240).optional().describe("实际记录到的摘要，不写未取得的想法"),
  reason: z.string().trim().min(1).max(240).optional().describe("可选：触发切换或故障的具体原因"),
});
export type BehaviorChipTerms = z.infer<typeof BehaviorChipTermsSchema>;

export const BehaviorChipCommandSchema = BehaviorChipTermsSchema.extend({
  type: z.literal("cyberware.behavior"),
}).describe(
  "玩家本人已安装行为芯片的四态切换（off/doll/protocol/glitch）、设备摘要记录与查阅；不替玩家自动安装或替玩家做情感决定。安全词随时切回 off。",
);
export type BehaviorChipCommand = z.infer<typeof BehaviorChipCommandSchema>;

/** 义体表的一条；数据在 content 包的 cyberware.ts */
export const CyberwareDefSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  slot: CyberwareSlotSchema,
  rarity: RaritySchema,
  /** 义体医生的参考价，含安装费 */
  price: z.number().int().min(0),
  /** 装着时人性上限降低多少 */
  humanityCost: z.number().int().min(0).max(20),
  /** 装上后角色真的能做到什么；写给模型，也显示在侧栏 */
  ability: z.string().min(1),
  /** 护甲义体：提供身体防护，具体承受能力与覆盖部位按现场与装备描述判断 */
  armor: z.boolean().default(false),
  /**
   * 黑客硬件的定性特化方向；操作系统义体写了这一项才算网络接入仓，
   * 额叶皮质等义体写了则作为脑部黑客配件并入接入仓的特化。
   */
  deckTraits: z.array(DeckTraitSchema).optional(),
  /** 接入仓或黑客配件的档次与定位，一句话；写给模型，也显示在侧栏 */
  deckProfile: z.string().min(1).max(60).optional(),
  /** 接入仓可同时插装的程序芯片槽数（操作系统义体专用；未填时按档次推算） */
  deckSlots: z.number().int().min(2).max(8).optional(),
  /** 加速义体（斯安威斯坦）：生死瞬间可以开，按现场时距和设备能力加速行动 */
  accelerator: z.boolean().default(false),
  /** 不朽义体（原作的 Iconic）；稀有标签不替代真实货源与交易意愿 */
  iconic: z.boolean().default(false),
  behaviorChip: BehaviorChipProfileSchema.optional(),
});
export type CyberwareDef = z.infer<typeof CyberwareDefSchema>;

export const CyberwareCatalogSchema = z.array(CyberwareDefSchema);

/** 义体医生：开在某个地点，有自己的货架和价格；不以声望等级锁定货物。 */
export const RipperdocSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(20),
  /** 医生本人的人物卡 id；已确认死亡或在别处时不能亲自服务 */
  keeperNpc: z.string().min(1).optional(),
  /** 已登记、可在这间诊所提供同类服务的其他医生 */
  serviceNpcs: z.array(z.string().min(1)).default([]),
  /** 地点表里的 id：玩家在这里时才能找他 */
  location: z.string().min(1),
  note: z.string().max(120).default(""),
  /** 乘在义体表参考价上的系数 */
  priceFactor: z.number().min(0.5).max(2).default(1),
  /** 黑市来源标签；不自动推断故障、追踪器或惩罚 */
  blackMarket: z.boolean().default(false),
  /** 货架上的义体 id；标签不替代实际货源 */
  shelf: z.array(z.string().min(1)).min(1),
  initialStock: z.record(z.string(), z.number().int().min(0)).optional(),
  equipment: z.array(z.string().min(1)).default(["surgery"]),
  serviceMinutes: z
    .object({
      install: z.number().int().min(1).default(60),
      remove: z.number().int().min(1).default(30),
      repair: z.number().int().min(1).default(30),
    })
    .default({ install: 60, remove: 30, repair: 30 }),
  /** 目录价中安装服务的份额；自带件只支付这一部分 */
  serviceRate: z.number().min(0).max(1).default(0.2),
  /** 最多肯赊多少欧元；0 是不赊账 */
  credit: z.number().int().min(0).max(100_000).default(0),
  creditDays: z.number().int().min(1).nullable().default(null),
});
export type Ripperdoc = z.infer<typeof RipperdocSchema>;
export const RipperdocListSchema = z.array(RipperdocSchema);

/** 旧件折价回收：最多按参考价的两成，防低买高卖 */
export const TRADE_IN_RATE = 0.2;
/** 修理打坏的义体按参考价的几成收钱 */
export const REPAIR_RATE = 0.3;
/** 每笔已发生的欠款；只有明确约定期限时才记对应期限事件。 */
export const RipperdocDebtSchema = z.object({
  doc: z.string().min(1),
  docName: z.string().min(1),
  amount: z.number().int().min(1),
  due: z.number().int().nullable(),
  /** 对应的期限 id */
  deadline: z.string().min(1).nullable(),
});
export type RipperdocDebt = z.infer<typeof RipperdocDebtSchema>;

export const CyberwarePartSchema = z.object({
  id: z.string().min(1),
  model: z.string().min(1),
  holder: z.string().min(1),
  location: z.string().nullable(),
  condition: z.enum(["intact", "damaged", "scrapped"]),
  source: z.string().min(1),
  at: z.number().int(),
});
export type CyberwarePart = z.infer<typeof CyberwarePartSchema>;

export const ClinicStateSchema = z.object({
  definition: RipperdocSchema,
  stock: z.record(z.string(), z.number().int().min(0)),
  initializedAt: z.number().int(),
  revision: z.number().int().min(0),
  open: z.boolean(),
  reason: z.string(),
  staff: z.array(z.string()),
  equipment: z.array(z.string()),
});
export type ClinicState = z.infer<typeof ClinicStateSchema>;

export const CyberwareTermsSchema = z.object({
  action: z.enum(["buy", "install", "remove", "repair", "repay"]),
  doc: z.string().min(1).max(100),
  id: z.string().min(1).optional(),
  part: z
    .string()
    .min(1)
    .optional()
    .describe("自带的未安装实物 ID；不能把型号目录当成自己已持有的零件"),
  replace: z.string().min(1).optional().describe("玩家选定换下的已装型号；满槽不能自行选择"),
  disposition: z
    .enum(["keep", "sell", "scrap"])
    .optional()
    .describe("旧件明确去向：保留、出售或报废；必须有玩家授权"),
  tradeIn: z
    .boolean()
    .optional()
    .describe("只有玩家同意出售旧件时为 true，与 disposition:sell 一致"),
  credit: z.boolean().optional(),
  offer: z.string().min(1).optional(),
  startAt: z
    .number()
    .int()
    .optional()
    .describe("已经确认的服务开始游戏分钟；结束时刻由服务时长确定，不能重复增加耗时"),
});
export type CyberwareTerms = z.infer<typeof CyberwareTermsSchema>;

export const CyberwareServiceSchema = z.object({
  id: z.string().min(1),
  terms: CyberwareTermsSchema,
  provider: z.string().min(1),
  providerName: z.string().min(1),
  scheduledAt: z.number().int(),
  startedAt: z.number().int().nullable(),
  endsAt: z.number().int(),
  remaining: z.number().int().min(0),
  status: z.enum(["booked", "active", "interrupted", "cancelled", "completed"]),
  price: z.number().int().min(0),
  cash: z.number().int().min(0),
  credit: z.number().int().min(0),
  receive: z.number().int().min(0),
  part: z.string().nullable(),
  oldPart: z.string().nullable(),
  reason: z.string(),
});
export type CyberwareService = z.infer<typeof CyberwareServiceSchema>;

export const CyberwareSupplySchema = z.object({
  id: z.string().min(1),
  doc: z.string().min(1),
  source: z.string().min(1),
  stock: z.record(z.string(), z.number().int().min(1)),
  route: z.array(z.string().min(1)),
  due: z.number().int(),
  remaining: z.number().int().min(0),
  checkedAt: z.number().int(),
  status: z.enum(["pending", "blocked", "arrived", "cancelled"]),
  reason: z.string(),
});

export const CyberwareStateSchema = z.object({
  behaviorChips: z.record(z.string(), BehaviorChipStateSchema).optional(),
  installed: z
    .array(
      z.object({
        id: z.string().min(1),
        slot: CyberwareSlotSchema,
        /** 装上时的游戏时间（分钟） */
        installedAt: z.number().int(),
      }),
    )
    .default([]),
  /** 已经结算过的事件 id；同一事件只结算一次 */
  settled: z.array(z.string()).default([]),
  debts: z.array(RipperdocDebtSchema).default([]),
  clinics: z.record(z.string(), ClinicStateSchema).default({}),
  parts: z.record(z.string(), CyberwarePartSchema).default({}),
  services: z.record(z.string(), CyberwareServiceSchema).default({}),
  supplies: z.record(z.string(), CyberwareSupplySchema).default({}),
  /** 最近一次开加速义体：设备 id 与启动时间 */
  boost: z
    .object({ id: z.string().min(1), lastAt: z.number().int() })
    .nullable()
    .default(null),
});
export type CyberwareState = z.infer<typeof CyberwareStateSchema>;

/** 模型和按钮共用的义体交易；成交金额由当前医生报价决定。 */
export const CyberwareCommandSchema = CyberwareTermsSchema.extend({
  type: z.literal("cyberware"),
  reason: z.string().min(1),
  /** 事件 id；带上后同一事件只结算一次 */
  event: z.string().min(1).optional(),
})
  .strict()
  .describe(
    "义体交易：buy 只买下实物；install 购买并安装或以 part 指定自带件；remove 按 disposition 拆下保留/出售/报废；repair 维修；repay 还款。简单服务完成时按共同起止时刻推进时间；复杂手术走 cyberware.service。旧件处置必须明确，不自动出售；成交不另写 money/trade。",
  );
export type CyberwareCommand = z.infer<typeof CyberwareCommandSchema>;

/** 只能由代码发出：开局自带的义体，不扣钱 */
export const InstallCyberwareSchema = z.object({
  type: z.literal("cyberware.install"),
  id: z.string().min(1),
});
export type InstallCyberware = z.infer<typeof InstallCyberwareSchema>;

/** 只能由代码发出：在义体医生那里赊账（add）或还清（repay） */
export const RipperdocDebtCommandSchema = z.object({
  type: z.literal("cyberware.debt"),
  action: z.enum(["add", "repay"]),
  doc: z.string().min(1),
  docName: z.string().min(1),
  /** add 时赊多少 */
  amount: z.number().int().min(1).optional(),
  /** add 时赊的是哪件义体的尾款 */
  item: z.string().min(1).optional(),
  due: z.number().int().nullable().optional(),
});
export type RipperdocDebtCommand = z.infer<typeof RipperdocDebtCommandSchema>;

/** 只能由代码发出：玩家主动开启已安装且可用的加速义体 */
export const BoostCommandSchema = z.object({
  type: z.literal("cyberware.boost"),
  id: z.string().min(1),
});
export type BoostCommand = z.infer<typeof BoostCommandSchema>;
