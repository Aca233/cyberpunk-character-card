import { defineSystem } from "../../kernel/system";
import { applyChromeCare, applyLoot, applyMoney } from "./apply";
import { economyRules } from "./prompt";
import {
  type ChromeCareCommand,
  ChromeCareCommandSchema,
  type EconomyState,
  EconomyStateSchema,
  type LootCommand,
  LootCommandSchema,
  type MoneyCommand,
  MoneyCommandSchema,
} from "./schema";
import { economyStatus } from "./status";
import { moneyView } from "./view";

/** 欧元：身上的钱、生活体面与重度义体神经校准账单 */
export const economy = defineSystem<EconomyState, LootCommand, MoneyCommand | ChromeCareCommand>({
  id: "economy",
  state: EconomyStateSchema,
  initial: () => ({ eddies: 0, settled: [], chromeCarePaidUntil: null }),
  commands: { loot: LootCommandSchema },
  internal: { money: MoneyCommandSchema, "economy.payChromeCare": ChromeCareCommandSchema },
  apply: (draft, command) =>
    command.type === "money"
      ? applyMoney(draft, command)
      : command.type === "economy.payChromeCare"
        ? applyChromeCare(draft, command)
        : applyLoot(draft, command),
  rules: [economyRules],
  view: { key: "money", project: moneyView },
  status: economyStatus,
});

export * from "./apply";
export * from "./prompt";
export * from "./schema";
export * from "./status";
export * from "./view";
