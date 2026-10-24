import { defineSystem } from "../../kernel/system";
import { applyItem, applyMod, applyOutfit, itemCatalog, recharge, spend } from "./apply";
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
    outfit: {},
    mods: {},
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
      case "inventory.outfit":
        return applyOutfit(draft, command.action, itemCatalog(ctx.data));
      case "inventory.mod":
        return applyMod(draft, command.action, command.weapon, command.mod, itemCatalog(ctx.data));
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
