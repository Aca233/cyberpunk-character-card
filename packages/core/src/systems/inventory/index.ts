import { defineSystem } from "../../kernel/system";
import type { EconomyState } from "../economy";
import type { NpcState } from "../npc";
import type { WorldClockState } from "../world";
import { inventoryActions } from "./actions";
import {
  applyItem,
  applyMod,
  applyOutfit,
  applyParts,
  applyTrade,
  itemCatalog,
  markSold,
  shopHere,
  spend,
  stashMove,
  withWorldObjects,
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
  ItemCommand | TradeCommand,
  InventoryInternal | PartsCommand
>({
  id: "inventory",
  dependsOn: ["economy", "world", "npc"],
  state: InventoryStateSchema,
  initial: () => ({
    objects: {},
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
  commands: { item: ItemCommandSchema, trade: TradeCommandSchema },
  // 物品栏精简（用户定的方案 A）：零件规则不发给模型，parts 跟着从模型可用指令挪成内部指令；旧存档记录里的 parts 照旧能结算
  internal: { ...InventoryInternalSchemas, parts: PartsCommandSchema },
  apply(draft, command, ctx) {
    switch (command.type) {
      case "item":
        return applyItem(
          draft,
          command,
          itemCatalog(ctx.data),
          ctx.now,
          ctx.read<WorldClockState>("world").location,
          ctx.read<NpcState>("npc").npcs,
        );
      case "trade":
        return applyTrade(
          draft,
          command,
          itemCatalog(ctx.data),
          ctx.read<EconomyState>("economy"),
          shopHere(ctx.facts.shop, ctx.data),
          ctx.now,
          ctx.read<WorldClockState>("world").location,
          ctx.read<NpcState>("npc").npcs,
        );
      case "inventory.spend":
        return spend(draft, command.slot, undefined, ctx.now);
      case "inventory.sold":
        return markSold(draft, command.shop, command.item, command.at);
      case "inventory.outfit":
        return applyOutfit(draft, command.action, itemCatalog(ctx.data));
      case "inventory.stash":
        return stashMove(
          draft,
          command.action,
          command.id,
          ctx.now,
          ctx.read<WorldClockState>("world").location,
        );
      case "inventory.mod":
        return applyMod(draft, command.action, command.weapon, command.mod, itemCatalog(ctx.data));
      case "parts":
        return applyParts(draft, command);
    }
  },
  data: (state, data) => withWorldObjects(data, state.objects),
  sections: [
    {
      order: 76,
      title: "持续物件",
      render: ({ world, input }) => {
        const objects = InventoryStateSchema.parse(world.slices.inventory).objects;
        const here = (world.slices.world as WorldClockState).location;
        const lines = Object.entries(objects)
          .filter(
            ([id, o]) =>
              o.holder === "player" ||
              o.location === here ||
              input.text.includes(id) ||
              input.text.includes(o.definition.name),
          )
          .map(
            ([id, o]) =>
              `${id} ${o.definition.name}：归属 ${o.holder}，位置 ${o.location ?? "随持有人"}；来源 ${o.origin}；最近变化 ${o.lastChange}${o.definition.ability ? `；用途 ${o.definition.ability}` : ""}`,
          );
        return lines.length ? lines.join("\n") : undefined;
      },
    },
  ],
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
