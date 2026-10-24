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
  .describe(
    "欧元进出：收钱为正，花钱为负；余额不够时整条不生效。委托报酬由 jobEnd 结算，不另写 money",
  );
export type MoneyCommand = z.infer<typeof MoneyCommandSchema>;
