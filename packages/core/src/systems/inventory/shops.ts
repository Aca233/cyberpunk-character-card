import { z } from "zod";
import type { ViewContext } from "../../kernel/system";
import { keeperOf, RARITY_LABELS } from "../economy";
import { formatGameTime, WorldClockStateSchema } from "../world";
import {
  currentStock,
  itemCatalog,
  restockDue,
  shopList,
  stockOf,
  withWorldObjects,
} from "./apply";
import {
  carriedItemCounts,
  InventoryStateSchema,
  ITEM_KIND_LABELS,
  WEAPON_CATEGORY_LABELS,
} from "./schema";
import { quoteTrade } from "./trade";

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

/** 这一批卖过货时，下次补满的时间写成文字 */
function restockLabel(due: number | null): string | null {
  return due === null ? null : formatGameTime(due);
}

/** 当前地点开着的商店：货架按武器类别或物品种类分组；背包里的东西标出回收价 */
export function shopsView({ world, data }: ViewContext) {
  const location = WorldClockStateSchema.parse(world.slices.world).location;
  if (location === null || data.items === undefined) return [];
  const here = shopList(data).filter((s) => s.location === location);
  if (here.length === 0) return [];
  const inventory = InventoryStateSchema.parse(world.slices.inventory);
  const catalog = itemCatalog(withWorldObjects(data, inventory.objects));
  const npcs = KeeperCardsSchema.parse(world.slices.npc ?? {}).npcs;
  const now = world.time;
  return here.map((shop) => {
    const keeper = keeperOf(shop.keeperNpc, npcs);
    const sell = [...carriedItemCounts(inventory)].flatMap(([id, count]) => {
      const def = catalog.get(id);
      if (!def) return [];
      const quote = quoteTrade(
        world,
        data,
        { action: "sell", item: id, with: shop.id },
        { checkFunds: false },
      );
      return [{ id, name: def.name, count, value: quote.ok ? quote.price : 0 }];
    });
    const stock = currentStock(inventory.shopStock[shop.id], now);
    const shelfIds = [
      ...new Set([...shop.shelf, ...Object.keys(inventory.shopReturns[shop.id] ?? {})]),
    ];
    return {
      id: shop.id,
      name: shop.name,
      keeper: shop.keeper,
      /** 店主对你的好感；店主没有人物卡或还没见过是 null */
      keeperAffinity: keeper?.affinity ?? null,
      note: shop.note,
      blackMarket: shop.blackMarket,
      restockAt: restockLabel(restockDue(inventory.shopStock[shop.id], now)),
      shelf: shelfIds.flatMap((id) => {
        const def = catalog.get(id);
        if (!def) return [];
        const quote = quoteTrade(
          world,
          data,
          { action: "buy", item: id, with: shop.id },
          { checkFunds: false },
        );
        const object = inventory.objects[id];
        const left = quote.ok
          ? (quote.left ?? 0)
          : object
            ? object.holder === shop.id || object.holder === shop.keeperNpc
              ? 1
              : 0
            : Math.max(
                0,
                (shop.shelf.includes(id) ? stockOf(def) - (stock?.sold[id] ?? 0) : 0) +
                  (inventory.shopReturns[shop.id]?.[id] ?? 0),
              );
        return [
          {
            id: def.id,
            name: def.name,
            group:
              def.kind === "weapon" && def.category
                ? WEAPON_CATEGORY_LABELS[def.category]
                : ITEM_KIND_LABELS[def.kind],
            rarityLabel: def.rarity ? RARITY_LABELS[def.rarity] : null,
            price: quote.price ?? 0,
            ability: def.ability ?? null,
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
