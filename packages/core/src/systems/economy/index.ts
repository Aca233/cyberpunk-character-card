import { defineSystem } from "../../kernel/system";
import { applyMoney } from "./apply";
import { economyRules } from "./prompt";
import {
  type EconomyState,
  EconomyStateSchema,
  type MoneyCommand,
  MoneyCommandSchema,
} from "./schema";

/** 欧元：身上的钱和已经结算过的事件 */
export const economy = defineSystem<EconomyState, MoneyCommand>({
  id: "economy",
  state: EconomyStateSchema,
  initial: () => ({ eddies: 0, settled: [] }),
  commands: { money: MoneyCommandSchema },
  apply: (draft, command) => applyMoney(draft, command),
  rules: [economyRules],
});

export * from "./apply";
export * from "./prompt";
export * from "./schema";
