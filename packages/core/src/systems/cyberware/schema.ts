import { z } from "zod";
import { AttributeSchema } from "../dice";
import { RaritySchema } from "../economy";

/** 义体部位，按原作分类；同一部位只装一件 */
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
  /** 做哪些属性的检定时算有利条件 */
  checks: z.array(AttributeSchema).default([]),
  /** 装着时属性加多少（+1 至 +3）；把属性推到 11–20 主要靠它 */
  attributes: z.partialRecord(AttributeSchema, z.number().int().min(1).max(3)).default({}),
  /** 护甲义体：受到的伤害降一档；装着几件护甲也只降一档 */
  armor: z.boolean().default(false),
  /** 不朽义体（原作的 Iconic；军用级、原型）：只从剧情获得，义体医生不卖 */
  iconic: z.boolean().default(false),
});
export type CyberwareDef = z.infer<typeof CyberwareDefSchema>;

export const CyberwareCatalogSchema = z.array(CyberwareDefSchema);

/** 义体医生：开在某个地点，有自己的货架和价格；高稀有度的货随街头声望解锁。数据在 content 包的 ripperdocs.ts */
export const RipperdocSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(20),
  /** 地点表里的 id：玩家在这里时才能找他 */
  location: z.string().min(1),
  note: z.string().max(120).default(""),
  /** 乘在义体表参考价上的系数 */
  priceFactor: z.number().min(0.5).max(2).default(1),
  /** 黑市货：便宜，但可能有故障或追踪器，由主持人在剧情里兑现 */
  blackMarket: z.boolean().default(false),
  /** 货架上的义体 id；不朽义体放上来也不卖 */
  shelf: z.array(z.string().min(1)).min(1),
  /** 各稀有度要多少级街头声望才肯卖；没写的稀有度不设门槛 */
  credGates: z.partialRecord(RaritySchema, z.number().int().min(0).max(50)).default({}),
  /** 最多肯赊多少欧元；0 是不赊账 */
  credit: z.number().int().min(0).max(100_000).default(0),
});
export type Ripperdoc = z.infer<typeof RipperdocSchema>;
export const RipperdocListSchema = z.array(RipperdocSchema);

/** 旧件折价回收：最多按参考价的两成，防低买高卖 */
export const TRADE_IN_RATE = 0.2;
/** 修理打坏的义体按参考价的几成收钱 */
export const REPAIR_RATE = 0.3;
/** 赊账几天内还清 */
export const DEBT_DAYS = 7;

/** 欠义体医生的钱：一位医生同时只赊一笔，期限记在“期限与伏笔”里 */
export const RipperdocDebtSchema = z.object({
  doc: z.string().min(1),
  docName: z.string().min(1),
  amount: z.number().int().min(1),
  due: z.number().int(),
  /** 对应的期限 id */
  deadline: z.string().min(1),
});
export type RipperdocDebt = z.infer<typeof RipperdocDebtSchema>;

export const CyberwareStateSchema = z.object({
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
});
export type CyberwareState = z.infer<typeof CyberwareStateSchema>;

/** 模型使用：义体医生装、卸义体 */
export const CyberwareCommandSchema = z
  .object({
    type: z.literal("cyberware"),
    action: z.enum(["install", "remove"]),
    id: z.string().min(1),
    /** 不写时按义体表的价钱；谈下来的价或剧情白送时写，白送写 0 */
    price: z.number().int().min(0).max(200_000).optional(),
    reason: z.string().min(1),
    /** 事件 id；带上后同一事件只结算一次 */
    event: z.string().min(1).optional(),
  })
  .describe(
    "义体医生装、卸义体：install 按义体表扣欧元（谈下来的价或白送时写 price，白送写 0），余额不够时整条不生效；同一部位只装一件，装新的换下旧的；remove 卸下。人性上限由代码算，不另写 humanity",
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
});
export type RipperdocDebtCommand = z.infer<typeof RipperdocDebtCommandSchema>;
