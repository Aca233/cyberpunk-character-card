import { defineSystem } from "../../kernel/system";
import { applyLoot, applyMoney } from "./apply";
import { economyRules } from "./prompt";
import {
  type EconomyState,
  EconomyStateSchema,
  type LootCommand,
  LootCommandSchema,
  type MoneyCommand,
  MoneyCommandSchema,
} from "./schema";
import { moneyView } from "./view";

/** 欧元：身上的钱和已经结算过的事件 */
/** 欧元：模型只能写零钱 loot；买卖走物品系统的 trade，报酬走 jobEnd，其余由代码发 money */
export const economy = defineSystem<EconomyState, LootCommand, MoneyCommand>({
  id: "economy",
  state: EconomyStateSchema,
  initial: () => ({ eddies: 0, settled: [] }),
  commands: { loot: LootCommandSchema },
  internal: { money: MoneyCommandSchema },
  apply: (draft, command) =>
    command.type === "money" ? applyMoney(draft, command) : applyLoot(draft, command),
  rules: [economyRules],
  view: { key: "money", project: moneyView },
});

export * from "./apply";
export * from "./prompt";
export * from "./schema";
export * from "./view";
