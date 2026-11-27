import { z } from "zod";

/** 单条指令最多进出多少欧元；更大的交易拆开写，各自说明来由 */
/** 稀有度：义体和物品共用，决定价格档位（价格表见策划书的经济部分） */
export const RaritySchema = z.enum(["common", "uncommon", "rare", "epic", "legendary"]);
export type Rarity = z.infer<typeof RaritySchema>;

export const RARITY_LABELS: Readonly<Record<Rarity, string>> = {
  common: "普通",
  uncommon: "罕见",
  rare: "稀有",
  epic: "史诗",
  legendary: "传说",
};

/** 店主：人物卡上的名字和好感 */
export interface Keeper {
  readonly name: string;
}

/** 按人物卡找店主；没写店主人物、没有这张卡、还没见过或已经死了都返回 undefined */
export function keeperOf(
  npc: string | undefined,
  npcs: Readonly<Record<string, { name: string; met: boolean; alive: boolean } | undefined>>,
): Keeper | undefined {
  const card = npc === undefined ? undefined : npcs[npc];
  return card?.met && card.alive ? { name: card.name } : undefined;
}

export const MONEY_CAP = 100_000;

/** 重度义体神经校准周期（14 个游戏日）与触发门槛 */
export const CHROME_CARE_PERIOD_DAYS = 14;
export const CHROME_CARE_REMIND_BEFORE_DAYS = 3;
export const CHROME_CARE_LOAD_MIN = 18;
export const CHROME_CARE_HEAVY_COST = 1_500;
export const CHROME_CARE_EXTREME_COST = 3_500;

/** 夜之城身家与体面阶层（供叙事第一印象、高档门禁、开价与谈判筹码参考） */
export const WealthTierSchema = z.enum(["broke", "scraping", "comfortable", "affluent", "mogul"]);
export type WealthTier = z.infer<typeof WealthTierSchema>;

export const WEALTH_TIER_META: Readonly<
  Record<WealthTier, { readonly label: string; readonly summary: string }>
> = {
  broke: {
    label: "囊中羞涩",
    summary: "手头紧，赊账容易吃闭门羹，高端门禁与掮客多半冷眼相待",
  },
  scraping: {
    label: "街头勉强",
    summary: "普通夜之城佣兵手头，够付日常开销但谈大单拿不出多少垫资",
  },
  comfortable: {
    label: "手头宽裕",
    summary: "吃穿不愁、买装备和打点线人底气充足，街头中间人愿给实话",
  },
  affluent: {
    label: "阔绰体面",
    summary: "现金充裕或有体面家当，高档酒吧与门卫另眼相看，谈条件自带财力分量",
  },
  mogul: {
    label: "出手豪阔",
    summary: "财力与排面直抵上流，花钱办事极有分量，但也容易引来黑帮与掮客眼红设局",
  },
};

export const EconomyStateSchema = z.object({
  /** 身上的欧元 */
  eddies: z.number().int().min(0),
  /** 已经结算过的事件 id；同一事件只结算一次 */
  settled: z.array(z.string()),
  /** 重度义体神经校准维护已缴清至该游戏时刻（分钟）；null 表示按日历周期首期计 */
  chromeCarePaidUntil: z.number().int().nullable().optional(),
});
export type EconomyState = z.infer<typeof EconomyStateSchema>;

/** 仅代码发出：记录重度义体神经维护已续期到的时刻 */
export const ChromeCareCommandSchema = z.object({
  type: z.literal("economy.payChromeCare"),
  paidUntil: z.number().int(),
});
export type ChromeCareCommand = z.infer<typeof ChromeCareCommandSchema>;

/** 模型使用：{"type": "money", "delta": -40, "reason": "..."} */
export const MoneyCommandSchema = z
  .object({
    type: z.literal("money"),
    delta: z
      .number()
      .int()
      .min(-MONEY_CAP)
      .max(MONEY_CAP)
      .refine((v) => v !== 0, "欧元变化不能为 0"),
    reason: z.string().min(1),
    /** 事件 id；带上后同一事件只结算一次 */
    event: z.string().min(1).optional(),
  })
  .describe("欧元进出（只能由代码发出）：收钱为正，花钱为负；余额不够时整条不生效");
export type MoneyCommand = z.infer<typeof MoneyCommandSchema>;

/** 讲价的折扣档；换算表只在这里写一份（暂定，试玩时调） */
export const DiscountSchema = z.enum(["none", "small", "large"]);
export type Discount = z.infer<typeof DiscountSchema>;
export const DISCOUNT_FACTORS: Readonly<Record<Discount, number>> = {
  none: 1,
  small: 0.8,
  large: 0.5,
};

/** 服务价目表：不进物品栏的花销；叙事模型只写 id，价钱由代码查（暂定，试玩时调） */
export const ServiceSchema = z.enum([
  "meal",
  "drink",
  "lodging",
  "cab",
  "info",
  "medical",
  "fine",
  "favor",
  "bd-session",
  "adult-service",
]);
export type Service = z.infer<typeof ServiceSchema>;
export const SERVICES: Readonly<
  Record<Service, { readonly label: string; readonly price: number }>
> = {
  meal: { label: "吃一顿（街边摊、快餐）", price: 15 },
  drink: { label: "一杯酒", price: 10 },
  lodging: { label: "住一晚（胶囊旅馆）", price: 40 },
  cab: { label: "打车", price: 30 },
  info: { label: "买情报", price: 200 },
  medical: { label: "街头诊所看伤", price: 300 },
  fine: { label: "交罚款", price: 500 },
  favor: { label: "打点、请人帮个小忙", price: 100 },
  "bd-session": { label: "店内超梦体验", price: 50 },
  "adult-service": { label: "成年从业者服务", price: 200 },
};

/** 按折扣档算价钱，舍到十位，最少 10 */
/** 大额花费：一次花掉超过存款一半、且超过这个数，要玩家在提交前确认 */
export const BIG_SPEND_MIN = 1_000;

/** 钱不够的不算：结算会拒绝，用不着确认 */
export function isBigSpend(price: number, eddies: number): boolean {
  return price > BIG_SPEND_MIN && price * 2 > eddies && price <= eddies;
}

export function discounted(base: number, discount: Discount): number {
  return Math.max(10, Math.round((base * DISCOUNT_FACTORS[discount]) / 10) * 10);
}

/** 掉落表：零钱按对方档位和多少档查（暂定，试玩时调） */
export const LootAmountSchema = z.enum(["few", "some", "lots"]);
export type LootAmount = z.infer<typeof LootAmountSchema>;
export const LootTierSchema = z.enum(["street", "veteran", "elite", "legend"]);
export type LootTier = z.infer<typeof LootTierSchema>;
export const LOOT_EDDIES: Readonly<Record<LootTier, Readonly<Record<LootAmount, number>>>> = {
  street: { few: 50, some: 150, lots: 400 },
  veteran: { few: 200, some: 500, lots: 1200 },
  elite: { few: 600, some: 1500, lots: 4000 },
  legend: { few: 2000, some: 5000, lots: 12000 },
};

/** 模型使用：到手的零钱，只选多少和档位 */
export const LootCommandSchema = z
  .object({
    type: z.literal("loot"),
    amount: LootAmountSchema.describe("few 一点，some 一些，lots 很多"),
    tier: LootTierSchema.describe(
      "钱从谁那里来：street 街头混混，veteran 帮派精锐和公司保安，elite 荒坂精英，legend 传奇人物；不是从人身上来的按场面选相当的档",
    ),
    reason: z.string().min(1),
    event: z.string().min(1).optional().describe("同一批战利品写同一个 id，只结算一次"),
  })
  .describe(
    "到手的零钱：搜到的钱、顺手摸到的、雇主另给的小费；只选多少和档位，不写数字，代码查掉落表",
  );
export type LootCommand = z.infer<typeof LootCommandSchema>;
