import { z } from "zod";
import { credGateLabel } from "../character";

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

/**
 * 店主好感解锁（本作改编，暂定，试玩后再调）：店主有人物卡、见过面、还活着，好感到这一档时，
 * 街头声望没到门槛的这档货也肯卖
 */
export const KEEPER_AFFINITY_GATES: Readonly<Partial<Record<Rarity, number>>> = {
  rare: 20,
  epic: 40,
  legendary: 60,
};

/** 店主：人物卡上的名字和好感 */
export interface Keeper {
  readonly name: string;
  readonly affinity: number;
}

/** 按人物卡找店主；没写店主人物、没有这张卡、还没见过或已经死了都返回 undefined */
export function keeperOf(
  npc: string | undefined,
  npcs: Readonly<
    Record<string, { name: string; affinity: number; met: boolean; alive: boolean } | undefined>
  >,
): Keeper | undefined {
  const card = npc === undefined ? undefined : npcs[npc];
  return card?.met && card.alive ? { name: card.name, affinity: card.affinity } : undefined;
}

/** 稀有度门槛：街头声望够，或者店主好感到了就卖；都不够时返回原因，卖就返回 null */
export function rarityLock(
  rarity: Rarity | undefined,
  credGates: Readonly<Partial<Record<Rarity, number>>>,
  streetCred: number,
  keeper?: Keeper,
): string | null {
  if (rarity === undefined) return null;
  const gate = credGates[rarity];
  if (gate === undefined || streetCred >= gate) return null;
  const req = credGateLabel(gate);
  const warm = KEEPER_AFFINITY_GATES[rarity];
  if (keeper === undefined || warm === undefined) return `${req}才肯卖`;
  if (keeper.affinity >= warm) return null;
  return `${req}，或者和${keeper.name}交情够深，才肯卖`;
}

export const MONEY_CAP = 100_000;

export const EconomyStateSchema = z.object({
  /** 身上的欧元 */
  eddies: z.number().int().min(0),
  /** 已经结算过的事件 id；同一事件只结算一次 */
  settled: z.array(z.string()),
});
export type EconomyState = z.infer<typeof EconomyStateSchema>;

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
