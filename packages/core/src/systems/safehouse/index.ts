import { defineSystem } from "../../kernel/system";
import { safehouseActions } from "./actions";
import { applyStash, applyTrophy, seedHome } from "./apply";
import { safehouseInteractions } from "./interactions";
import { safehouseRules } from "./prompt";
import {
  type SafehouseInternal,
  SafehouseInternalSchemas,
  type SafehouseState,
  SafehouseStateSchema,
  type StashCommand,
  StashCommandSchema,
  type TrophyCommand,
  TrophyCommandSchema,
} from "./schema";
import { safehouseView } from "./view";

/** 安全屋：开局按出身给一处住所；存放箱、后备箱和战利品墙 */
export const safehouse = defineSystem<
  SafehouseState,
  StashCommand | TrophyCommand,
  SafehouseInternal
>({
  id: "safehouse",
  dependsOn: ["world", "inventory", "travel"],
  state: SafehouseStateSchema,
  initial: () => ({ homes: [], stash: {}, trophies: [] }),
  commands: { stash: StashCommandSchema, trophy: TrophyCommandSchema },
  internal: SafehouseInternalSchemas,
  apply(draft, command, ctx) {
    switch (command.type) {
      case "stash":
        return applyStash(draft, command, ctx);
      case "trophy":
        return applyTrophy(draft, command, ctx);
      case "safehouse.seed":
        return seedHome(draft, command, ctx.now);
    }
  },
  rules: [safehouseRules],
  actions: safehouseActions,
  view: { key: "safehouse", project: safehouseView },
  interactions: safehouseInteractions,
});

export * from "./actions";
export * from "./apply";
export * from "./interactions";
export * from "./prompt";
export * from "./schema";
export * from "./view";
