import { defineSystem } from "../../kernel/system";
import type { EconomyState } from "../economy";
import { inventoryActions } from "./actions";
import {
  applyItem,
  applyMod,
  applyOutfit,
  applyParts,
  applyTrade,
  dismantle,
  itemCatalog,
  markSold,
  recharge,
  shopHere,
  spend,
  stashMove,
  tune,
} from "./apply";
import { inventoryEvents } from "./events";
import { inventoryInteractions } from "./interactions";
import { namesView } from "./names";
import {
  type InventoryInternal,
  InventoryInternalSchemas,
  type InventoryState,
  InventoryStateSchema,
  type ItemCommand,
  ItemCommandSchema,
  type PartsCommand,
  PartsCommandSchema,
  type TradeCommand,
  TradeCommandSchema,
} from "./schema";
import { shopsView } from "./shops";
import { inventoryStatus } from "./status";
import { inventoryView } from "./view";

export const inventory = defineSystem<
  InventoryState,
  ItemCommand | TradeCommand | PartsCommand,
  InventoryInternal
>({
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
    parts: 0,
    tuned: {},
    shopStock: {},
  }),
  commands: { item: ItemCommandSchema, trade: TradeCommandSchema, parts: PartsCommandSchema },
  internal: InventoryInternalSchemas,
  apply(draft, command, ctx) {
    switch (command.type) {
      case "item":
        return applyItem(draft, command, itemCatalog(ctx.data));
      case "trade":
        return applyTrade(
          draft,
          command,
          itemCatalog(ctx.data),
          ctx.read<EconomyState>("economy"),
          shopHere(ctx.facts.shop, ctx.data),
        );
      case "inventory.spend":
        return spend(draft, command.slot);
      case "inventory.recharge":
        return recharge(draft);
      case "inventory.sold":
        return markSold(draft, command.shop, command.item, command.at);
      case "inventory.outfit":
        return applyOutfit(draft, command.action, itemCatalog(ctx.data));
      case "inventory.stash":
        return stashMove(draft, command.action, command.id);
      case "inventory.mod":
        return applyMod(draft, command.action, command.weapon, command.mod, itemCatalog(ctx.data));
      case "parts":
        return applyParts(draft, command);
      case "inventory.dismantle":
        return dismantle(draft, command.id, itemCatalog(ctx.data));
      case "inventory.tune":
        return tune(draft, command.id, command.tech, itemCatalog(ctx.data));
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
  // 物品栏精简（用户定的方案 A）：零件和升级不再出现，零件规则不发给模型；partsRules 留着，以后想加回来再挂上
  rules: [],
  actions: inventoryActions,
  view: { key: "inventory", project: inventoryView },
  views: [
    { key: "shops", project: shopsView },
    { key: "names", project: namesView },
  ],
  status: inventoryStatus,
  interactions: inventoryInteractions,
  events: inventoryEvents,
});

export * from "./actions";
export * from "./apply";
export * from "./events";
export * from "./interactions";
export * from "./names";
export * from "./prompt";
export * from "./schema";
export * from "./shops";
export * from "./status";
export * from "./view";
