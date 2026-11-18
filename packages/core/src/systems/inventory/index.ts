import { defineSystem } from "../../kernel/system";
import type { LogisticsState } from "../logistics";
import type { NpcState } from "../npc";
import type { WorldClockState } from "../world";
import { inventoryActions } from "./actions";
import {
  applyItem,
  applyMod,
  applyParts,
  applyPlaceItem,
  itemCatalog,
  relocateVehiclePlaced,
  spend,
  withWorldObjects,
} from "./apply";
import { inventoryEvents } from "./events";
import { inventoryInteractions } from "./interactions";
import { applyShopBusiness, visitMerchants, withMerchants } from "./merchants";
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
  type ShopBusinessCommand,
  ShopBusinessCommandSchema,
  type ShopOrderCommand,
  ShopOrderCommandSchema,
  type TradeCommand,
  TradeCommandSchema,
} from "./schema";
import { shopsView } from "./shops";
import { inventoryStatus } from "./status";
import { applyShopOrder, progressSupplies, supplyOrderLines } from "./supply";
import { applyTrade } from "./trade";
import { inventoryView } from "./view";

export const inventory = defineSystem<
  InventoryState,
  ItemCommand | TradeCommand | ShopBusinessCommand | ShopOrderCommand,
  InventoryInternal | PartsCommand
>({
  id: "inventory",
  dependsOn: ["economy", "world", "npc", "factions", "commerce", "city", "logistics"],
  state: InventoryStateSchema,
  initial: () => ({
    objects: {},
    placed: [],
    weapons: [null, null, null],
    active: null,
    healing: null,
    grenade: null,
    backpack: {},
    depleted: {},
    clothing: {},
    mods: {},
    parts: 0,
    tuned: {},
    merchants: {},
    supplyOrders: {},
    nextSupply: 1,
  }),
  commands: {
    item: ItemCommandSchema,
    trade: TradeCommandSchema,
    shopBusiness: ShopBusinessCommandSchema,
    shopOrder: ShopOrderCommandSchema,
  },
  // 物品栏精简（用户定的方案 A）：零件规则不发给模型，parts 跟着从模型可用指令挪成内部指令；旧存档记录里的 parts 照旧能结算
  internal: { ...InventoryInternalSchemas, parts: PartsCommandSchema },
  apply(draft, command, ctx) {
    switch (command.type) {
      case "shopOrder":
        return applyShopOrder(draft, command, ctx);
      case "shopBusiness":
        return applyShopBusiness(draft, command, ctx);
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
          {
            time: ctx.now,
            slices: {
              inventory: draft,
              economy: ctx.read("economy"),
              world: ctx.read("world"),
              npc: ctx.read("npc"),
              factions: ctx.read("factions"),
              commerce: ctx.read("commerce"),
              logistics: ctx.read("logistics"),
              cyberware: ctx.data.clinicOperations,
            },
          },
          ctx.data,
          ctx.facts,
        );
      case "inventory.spend":
        return spend(draft, command.slot, undefined, ctx.now);
      case "inventory.place":
        return applyPlaceItem(draft, command, itemCatalog(ctx.data), ctx.now);
      case "inventory.relocateVehicle":
        relocateVehiclePlaced(draft, command.vehicle, command.location);
        return { ok: true };
      case "inventory.mod":
        return applyMod(draft, command.action, command.weapon, command.mod, itemCatalog(ctx.data));
      case "parts":
        return applyParts(draft, command);
    }
  },
  data: (state, data) => withWorldObjects(withMerchants(data, state.merchants), state.objects),
  on: {
    "world.arrived": visitMerchants,
    "logistics.changed": (draft, ctx) =>
      progressSupplies(draft, ctx.now, ctx.read<LogisticsState>("logistics")),
  },
  tick: (draft, _span, ctx) => {
    visitMerchants(draft, ctx);
    progressSupplies(draft, ctx.now, ctx.read<LogisticsState>("logistics"));
  },
  sections: [
    {
      order: 78,
      title: "商店供货与订货",
      render: ({ world }) => {
        const lines = supplyOrderLines(InventoryStateSchema.parse(world.slices.inventory));
        return lines.length ? lines.join("\n") : undefined;
      },
    },
    {
      order: 76,
      title: "持续物件",
      render: ({ world, input }) => {
        const objects = InventoryStateSchema.parse(world.slices.inventory).objects;
        const here = (world.slices.world as WorldClockState).location;
        const lines = Object.entries(objects)
          .filter(
            ([id, o]) =>
              (o.holder !== "consumed" && (o.holder === "player" || o.location === here)) ||
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
  rules: [
    {
      id: "merchant",
      title: "商店经营",
      commands: ["shopBusiness", "shopOrder"],
      when: (state, input) =>
        Object.keys(state.merchants).length > 0 ||
        /商店|店主|店员|开业|停业|关门|接替/.test(input.text),
      text: "- 商店身份、库存与营业持续保存，重访不重置。实际停业/恢复或人员接替写 shopBusiness，并引用本轮正文证据；路过的人不自动成为店员。没有人员位置记录不代表已经离场，明确死亡或离场的人不能本人营业。订货和取消需店方实际同意后写shopOrder，引用正文证据；本批订货均为到货后付款，不预扣订金、不生成债务。正常到货只由保存的供货单推进，不凭时间补满。",
    },
  ],
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
export * from "./merchants";
export * from "./names";
export * from "./prompt";
export * from "./schema";
export * from "./shops";
export * from "./status";
export * from "./supply";
export * from "./trade";
export * from "./view";
