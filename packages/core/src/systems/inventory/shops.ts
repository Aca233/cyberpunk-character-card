import { z } from "zod";
import type { ViewContext } from "../../kernel/system";
import { keeperOf, RARITY_LABELS } from "../economy";
import { formatGameTime, merchantAt, merchantSites, WorldClockStateSchema } from "../world";
import { itemCatalog, rarityOf, shopList, withWorldObjects } from "./apply";
import { merchantState, withMerchants } from "./merchants";
import { weaponDisplayNames } from "./names";
import {
  CLOTHING_SLOT_LABELS,
  carriedItemCounts,
  InventoryStateSchema,
  ITEM_KIND_LABELS,
  type ItemDef,
  isBulkyItem,
  MOD_SLOT_LABELS,
  projectWeaponState,
  WEAPON_CATEGORY_LABELS,
  WEAPON_TYPE_LABELS,
  type WeaponInstanceState,
} from "./schema";
import { quoteTrade } from "./trade";

function itemGroup(def: ItemDef): string {
  return def.kind === "weapon" && def.category
    ? WEAPON_CATEGORY_LABELS[def.category]
    : ITEM_KIND_LABELS[def.kind];
}

function itemSubLabel(def: ItemDef): string {
  if (def.kind === "weapon") {
    return [
      def.weaponType ? WEAPON_TYPE_LABELS[def.weaponType] : null,
      def.category ? WEAPON_CATEGORY_LABELS[def.category] : null,
    ]
      .filter(Boolean)
      .join("");
  }
  if (def.kind === "clothing" && def.clothingSlot) {
    return CLOTHING_SLOT_LABELS[def.clothingSlot];
  }
  if (def.kind === "mod" && def.modSlot) {
    return `改装 · ${MOD_SLOT_LABELS[def.modSlot]}`;
  }
  return ITEM_KIND_LABELS[def.kind];
}

function itemMeta(def: ItemDef, ws: WeaponInstanceState | undefined) {
  const baseId = ws?.baseId ?? def.id;
  const rar = def.rarity || def.kind === "weapon" ? rarityOf(def, ws) : null;
  return {
    baseId,
    group: itemGroup(def),
    kind: def.kind,
    subLabel: itemSubLabel(def),
    rarity: rar,
    rarityLabel: def.iconic ? "不朽" : rar ? RARITY_LABELS[rar] : null,
    iconic: def.iconic ?? false,
    ability: def.ability ?? null,
    bulky: isBulkyItem(def, baseId),
    weaponState: projectWeaponState(ws),
  };
}

/**
 * npc 的入口引用了 inventory（npc/body.ts），这里不反向引用 npc 的入口；
 * 只读取找店主要用的四项，不把人物卡的其他内容带进商店投影
 */
const KeeperCardsSchema = z.object({
  npcs: z
    .record(
      z.string(),
      z.object({ name: z.string(), affinity: z.number(), met: z.boolean(), alive: z.boolean() }),
    )
    .default({}),
});

/** 当前地点开着的商店：货架按武器类别或物品种类分组；背包里的东西标出回收价 */
export function shopsView({ world, data }: ViewContext) {
  const location = WorldClockStateSchema.parse(world.slices.world).location;
  if (location === null || data.items === undefined) return [];
  const inventory = InventoryStateSchema.parse(world.slices.inventory);
  data = withMerchants(data, inventory.merchants);
  const here = shopList(data).filter((s) => merchantAt(data, s.id, s.location, location));
  if (here.length === 0) return [];
  const catalog = itemCatalog(withWorldObjects(data, inventory.objects));
  const sites = merchantSites(data);
  const npcs = KeeperCardsSchema.parse(world.slices.npc ?? {}).npcs;
  const sellCounts = carriedItemCounts(inventory);
  const sellNames = weaponDisplayNames(sellCounts.keys(), inventory.objects, catalog);
  const now = world.time;
  return here.map((shop) => {
    const keeper = keeperOf(shop.keeperNpc, npcs);
    const sell = [...sellCounts].flatMap(([id, count]) => {
      const obj = inventory.objects[id];
      const def = catalog.get(id) ?? obj?.definition;
      if (!def) return [];
      const quote = quoteTrade(
        world,
        data,
        { action: "sell", item: id, with: shop.id },
        { checkFunds: false },
      );
      return [
        {
          id,
          name: sellNames.get(id) ?? def.name,
          count,
          value: quote.ok ? quote.price : 0,
          ...itemMeta(def, obj?.weaponState),
          locked: quote.ok ? null : quote.reason,
        },
      ];
    });
    const merchant = merchantState(inventory, shop, catalog, now);
    const shelfIds = Object.keys(merchant.stock);
    const shelfNames = weaponDisplayNames(shelfIds, inventory.objects, catalog);
    const delivery = Object.values(inventory.supplyOrders)
      .filter((o) => o.shop === shop.id && (o.status === "pending" || o.status === "delayed"))
      .sort((a, b) => a.dueAt - b.dueAt)[0];
    return {
      id: shop.id,
      name: shop.name,
      kind: sites.get(shop.id)?.kind ?? null,
      keeper: shop.keeper,
      keeperNpc: shop.keeperNpc ?? null,
      /** 店主对你的好感；店主没有人物卡或还没见过是 null */
      keeperAffinity: keeper?.affinity ?? null,
      note: shop.note,
      blackMarket: shop.blackMarket,
      restockAt: delivery
        ? delivery.status === "delayed"
          ? `运输受阻：${delivery.delayReason}`
          : formatGameTime(delivery.dueAt)
        : null,
      shelf: shelfIds.flatMap((id) => {
        const obj = inventory.objects[id];
        const def = catalog.get(id) ?? obj?.definition;
        if (!def) return [];
        const quote = quoteTrade(
          world,
          data,
          { action: "buy", item: id, with: shop.id },
          { checkFunds: false },
        );
        const left = merchant.stock[id] ?? 0;
        return [
          {
            id: def.id,
            name: shelfNames.get(id) ?? def.name,
            ...itemMeta(def, obj?.weaponState),
            charges: def.charges ?? null,
            healPercent: def.healPercent ?? null,
            price: quote.price ?? 0,
            locked: quote.ok ? null : quote.reason,
            left,
          },
        ];
      }),
      /** 背包里的东西卖给这家店给多少；0 是不收 */
      sell,
    };
  });
}
