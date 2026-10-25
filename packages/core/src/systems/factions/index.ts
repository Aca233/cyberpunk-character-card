import { defineSystem } from "../../kernel/system";
import { applyFaction } from "./apply";
import { factionRules } from "./prompt";
import {
  type FactionCommand,
  FactionCommandSchema,
  type FactionsState,
  FactionsStateSchema,
} from "./schema";

/** 势力：每个帮派、公司对玩家的态度标签和一句理由；叙事模型按发生的事调整 */
export const factions = defineSystem<FactionsState, FactionCommand>({
  id: "factions",
  dependsOn: [],
  state: FactionsStateSchema,
  initial: () => ({ stances: {} }),
  commands: { faction: FactionCommandSchema },
  apply: (draft, command, ctx) => applyFaction(draft, command, ctx),
  rules: [factionRules],
});

export * from "./apply";
export * from "./prompt";
export * from "./schema";
