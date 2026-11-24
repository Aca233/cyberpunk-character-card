import { type ApplyOutcome, defineSystem } from "../../kernel/system";
import type { LogisticsState } from "../logistics";
import type { NpcState } from "../npc";
import type { WorldClockState } from "../world";
import { inventoryActions } from "./actions";
import {
  applyChipDrain,
  applyChipMint,
  applyChipWrite,
  applyItem,
  applyMod,
  applyParts,
  applyPlaceItem,
  applyWeaponHold,
  itemCatalog,
  reconcileHeldWeapons,
  relocateVehiclePlaced,
  spend,
  withWorldObjects,
} from "./apply";
import { inventoryEvents } from "./events";
import { applyGunsmith, type GunsmithCommand, GunsmithCommandSchema } from "./gunsmith";
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
  type WeaponHoldCommand,
  WeaponHoldCommandSchema,
} from "./schema";
import { shopsView } from "./shops";
import { inventoryStatus } from "./status";
import { applyShopOrder, progressSupplies, supplyOrderLines } from "./supply";
import { applyTrade } from "./trade";
import { inventoryView } from "./view";

export const inventory = defineSystem<
  InventoryState,
  | ItemCommand
  | TradeCommand
  | GunsmithCommand
  | ShopBusinessCommand
  | ShopOrderCommand
  | WeaponHoldCommand,
  InventoryInternal | PartsCommand
>({
  id: "inventory",
  dependsOn: ["economy", "world", "npc", "factions", "commerce", "city", "logistics"],
  state: InventoryStateSchema,
  initial: () => ({
    objects: {},
    placed: [],
    healing: null,
    grenade: null,
    backpack: {},
    heldWeapons: null,
    clothing: {},
    parts: 0,
    claimedQuickhacks: [],
    merchants: {},
    supplyOrders: {},
    nextSupply: 1,
    nextWeaponSeq: 1,
    nextSupplyInstanceSeq: 1,
  }),
  commands: {
    item: ItemCommandSchema,
    weaponHold: WeaponHoldCommandSchema,
    trade: TradeCommandSchema,
    gunsmith: GunsmithCommandSchema,
    shopBusiness: ShopBusinessCommandSchema,
    shopOrder: ShopOrderCommandSchema,
  },
  // 物品栏精简（用户定的方案 A）：零件规则不发给模型，parts 跟着从模型可用指令挪成内部指令；旧存档记录里的 parts 照旧能结算
  internal: { ...InventoryInternalSchemas, parts: PartsCommandSchema },
  apply(draft, command, ctx) {
    const execute = (): ApplyOutcome => {
      switch (command.type) {
        case "inventory.chipWrite":
          return applyChipWrite(draft, command, ctx.now);
        case "inventory.chipDrain":
          return applyChipDrain(draft, command, ctx.now);
        case "inventory.chipMint":
          return applyChipMint(
            draft,
            command,
            ctx.now,
            ctx.read<WorldClockState>("world").location,
          );
        case "weaponHold":
          return applyWeaponHold(
            draft,
            command,
            itemCatalog(withWorldObjects(ctx.data, draft.objects)),
          );
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
        case "gunsmith":
          return applyGunsmith(
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
              },
            },
            ctx.data,
            ctx.facts,
          );
        case "inventory.spend":
          return spend(draft, command.slot, itemCatalog(ctx.data), undefined, ctx.now);
        case "inventory.place":
          return applyPlaceItem(draft, command, itemCatalog(ctx.data), ctx.now);
        case "inventory.relocateVehicle":
          relocateVehiclePlaced(draft, command.vehicle, command.location);
          return { ok: true };
        case "inventory.mod":
          return applyMod(
            draft,
            command.action,
            command.weapon,
            command.mod,
            itemCatalog(withWorldObjects(ctx.data, draft.objects)),
            ctx.now,
          );
        case "parts":
          return applyParts(draft, command);
      }
    };
    const outcome = execute();
    if (outcome.ok && draft.heldWeapons?.length) {
      const catalog =
        ctx.data.items === undefined
          ? new Map()
          : itemCatalog(withWorldObjects(ctx.data, draft.objects));
      reconcileHeldWeapons(draft, catalog);
    }
    return outcome;
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
              o.kind !== "customized" &&
              ((o.holder !== "consumed" && (o.holder === "player" || o.location === here)) ||
                input.text.includes(id) ||
                input.text.includes(o.definition.name)),
          )
          .map(([id, o]) => {
            const holderLabel = o.holder.startsWith("shop:")
              ? `商店 ${o.holder.slice(5)} 在库`
              : o.holder;
            const locationLabel = o.holder.startsWith("shop:")
              ? "店面货架"
              : (o.location ?? "随持有人");
            return `${id} ${o.definition.name}：归属 ${holderLabel}，位置 ${locationLabel}；来源 ${o.origin}；最近变化 ${o.lastChange}${o.definition.ability ? `；用途 ${o.definition.ability}` : ""}`;
          });
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
      judge:
        "- 商店身份、库存与营业状态持续保存，重访不重置；明确死亡或离场的人不能本人营业，路过的人不自动顶班。订货需店方同意且均为到货后付款，不凭时间自动补满。",
      narrate:
        "- 商店身份、库存与营业状态持续延续，重访不刷新老板或货架；明确死亡或离场的人不在店里营业。订货与取消以店方真实答复为准。",
      text: "- 商店身份、库存与营业持续保存，重访不重置。实际停业/恢复或人员接替写 shopBusiness，并引用本轮正文证据；路过的人不自动成为店员。没有人员位置记录不代表已经离场，明确死亡或离场的人不能本人营业。订货和取消需店方实际同意后写 shopOrder，引用正文证据；本批订货均为到货后付款，不预扣订金、不生成债务。正常到货只由保存的供货单推进，不凭时间补满。",
    },
    {
      id: "gunsmith",
      title: "枪匠工坊",
      commands: ["gunsmith"],
      when: (state, input) =>
        Object.values(state.objects).some((o) => o.kind === "customized") ||
        /枪匠|工坊|改装|加装|拆下|解锁|强化武器|智能连接|智能握把|固锁|威尔逊|武器摊/.test(
          input.text,
        ),
      judge:
        "- 常规未锁定的瞄准镜、枪口和插件在界面上自行免费装卸，无需枪匠收费；只有从商店货架直接购买并安装、拆改已锁定槽位，或加装智能靶向联锁/精工固锁改造时，才构成枪匠定制服务。",
      narrate:
        "- 枪匠改装按给定报价与现货写入正文；询价、砍价或未接受的条件不能写成已经改装或扣款。",
      text: "- gunsmith：与商店枪匠完成的定制服务（install 从货架或背包安装改装件，detach 拆除已锁定改装件并解锁槽位，convert 为智能武器加装智能靶向联锁模块或精工固锁已装槽位）。shop 与各项参数须与本轮共同报价一致，不得自填金额，不另发 money、item 或 trade 重复扣款。",
    },
  ],
  actions: inventoryActions,
  view: { key: "inventory", project: inventoryView },
  views: [
    { key: "shops", project: shopsView },
    { key: "names", project: namesView },
  ],
  status: inventoryStatus,
  events: inventoryEvents,
});

export * from "./actions";
export * from "./apply";
export * from "./events";
export * from "./gunsmith";
export * from "./merchants";
export * from "./names";
export * from "./prompt";
export * from "./schema";
export * from "./shops";
export * from "./status";
export * from "./supply";
export * from "./trade";
export * from "./view";
