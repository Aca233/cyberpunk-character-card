import { defineSystem } from "../../kernel/system";
import { safehouseActions } from "./actions";
import { applyStash, seedHome } from "./apply";
import { safehouseInteractions } from "./interactions";
import { safehouseRules } from "./prompt";
import {
  type SafehouseInternal,
  SafehouseInternalSchemas,
  type SafehouseState,
  SafehouseStateSchema,
  type StashCommand,
  StashCommandSchema,
} from "./schema";
import { safehouseStatus } from "./status";
import { safehouseView } from "./view";

/** 安全屋：开局按出身给一处住所；存放箱与后备箱 */
export const safehouse = defineSystem<SafehouseState, StashCommand, SafehouseInternal>({
  id: "safehouse",
  dependsOn: ["world", "inventory", "travel", "cyberware"],
  state: SafehouseStateSchema,
  initial: () => ({ homes: [], stash: {}, trophies: [] }),
  commands: { stash: StashCommandSchema },
  internal: SafehouseInternalSchemas,
  apply(draft, command, ctx) {
    switch (command.type) {
      case "stash":
        return applyStash(draft, command, ctx);
      case "safehouse.seed":
        return seedHome(draft, command, ctx.now);
    }
  },
  rules: [safehouseRules],
  actions: safehouseActions,
  view: { key: "safehouse", project: safehouseView },
  status: safehouseStatus,
  interactions: safehouseInteractions,
});

export * from "./actions";
export * from "./apply";
export * from "./interactions";
export * from "./prompt";
export * from "./schema";
export * from "./status";
export * from "./view";
