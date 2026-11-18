import { defineSystem } from "../../kernel/system";
import { safehouseActions } from "./actions";
import { applyHome, applyItemPlace, seedHome } from "./apply";
import { safehouseRules } from "./prompt";
import {
  type HomeCommand,
  HomeCommandSchema,
  type ItemPlaceCommand,
  ItemPlaceCommandSchema,
  type SafehouseInternal,
  SafehouseInternalSchemas,
  type SafehouseState,
  SafehouseStateSchema,
} from "./schema";
import { safehouseStatus } from "./status";
import { safehouseView } from "./view";

/** 安全屋与留置：开局按出身给一处住所，支持故事中获得/失去住处与关键物品留置记录 */
export const safehouse = defineSystem<
  SafehouseState,
  ItemPlaceCommand | HomeCommand,
  SafehouseInternal
>({
  id: "safehouse",
  dependsOn: ["world", "inventory", "travel", "cyberware", "npc"],
  state: SafehouseStateSchema,
  initial: () => ({ homes: [] }),
  commands: { itemPlace: ItemPlaceCommandSchema, home: HomeCommandSchema },
  internal: SafehouseInternalSchemas,
  apply(draft, command, ctx) {
    switch (command.type) {
      case "itemPlace":
        return applyItemPlace(draft, command, ctx);
      case "home":
        return applyHome(draft, command, ctx);
      case "safehouse.seed":
        return seedHome(draft, command, ctx.now);
    }
  },
  rules: [safehouseRules],
  actions: safehouseActions,
  view: { key: "safehouse", project: safehouseView },
  status: safehouseStatus,
});

export * from "./actions";
export * from "./apply";
export * from "./prompt";
export * from "./schema";
export * from "./status";
export * from "./view";
