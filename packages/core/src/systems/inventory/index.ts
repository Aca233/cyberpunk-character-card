import { defineSystem } from "../../kernel/system";
import { applyItem, itemCatalog, recharge, spend } from "./apply";
import {
  type InventoryInternal,
  InventoryInternalSchemas,
  type InventoryState,
  InventoryStateSchema,
  type ItemCommand,
  ItemCommandSchema,
} from "./schema";

export const inventory = defineSystem<InventoryState, ItemCommand, InventoryInternal>({
  id: "inventory",
  dependsOn: ["dice", "economy"],
  state: InventoryStateSchema,
  initial: () => ({
    weapons: [null, null, null],
    active: null,
    healing: null,
    grenade: null,
    backpack: {},
    depleted: {},
    clothing: {},
  }),
  commands: { item: ItemCommandSchema },
  internal: InventoryInternalSchemas,
  apply(draft, command, ctx) {
    switch (command.type) {
      case "item":
        return applyItem(draft, command, itemCatalog(ctx.data));
      case "inventory.spend":
        return spend(draft, command.slot);
      case "inventory.recharge":
        return recharge(draft);
    }
  },
  on: {
    "scene.end": (draft) => {
      recharge(draft);
    },
    rest: (draft) => {
      recharge(draft);
    },
  },
});

export * from "./apply";
export * from "./schema";
