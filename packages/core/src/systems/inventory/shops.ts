import { z } from "zod";
import type { ViewContext } from "../../kernel/system";
import { CharacterStateSchema } from "../character";
import { keeperOf, RARITY_LABELS } from "../economy";
import { formatGameTime, WorldClockStateSchema } from "../world";
import { currentStock, itemCatalog, restockDue, sellValue, shopList, shopShelf } from "./apply";
import { moodLock, moodPrice, shopMood } from "./mood";
import { InventoryStateSchema, ITEM_KIND_LABELS, WEAPON_CATEGORY_LABELS } from "./schema";

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
  const catalog = itemCatalog(data);
  const here = shopList(data).filter((s) => s.location === location);
  if (here.length === 0) return [];
  const inventory = InventoryStateSchema.parse(world.slices.inventory);
  const streetCred = CharacterStateSchema.parse(world.slices.character).streetCred;
  const npcs = KeeperCardsSchema.parse(world.slices.npc ?? {}).npcs;
  const now = world.time;
  const sell = Object.entries(inventory.backpack).flatMap(([id, count]) => {
    const def = catalog.get(id);
    return def ? [{ id, name: def.name, count, value: sellValue(def) }] : [];
  });
  return here.map((shop) => {
    const keeper = keeperOf(shop.keeperNpc, npcs);
    // 势力态度影响店价（用户 2026-10-31 选的「势力进机制」）：和买的时候一样算
    const mood = shopMood(world, data, shop);
    const moodLocked = moodLock(mood);
    return {
      id: shop.id,
      name: shop.name,
      keeper: shop.keeper,
      /** 店主对你的好感；店主没有人物卡或还没见过是 null */
      keeperAffinity: keeper?.affinity ?? null,
      note: shop.note,
      blackMarket: shop.blackMarket,
      restockAt: restockLabel(restockDue(inventory.shopStock[shop.id], now)),
      shelf: shopShelf(
        shop,
        catalog,
        streetCred,
        currentStock(inventory.shopStock[shop.id], now),
        keeper,
      ).map(({ def, price, locked, left }) => ({
        id: def.id,
        name: def.name,
        group:
          def.kind === "weapon" && def.category
            ? WEAPON_CATEGORY_LABELS[def.category]
            : ITEM_KIND_LABELS[def.kind],
        rarityLabel: def.rarity ? RARITY_LABELS[def.rarity] : null,
        price: moodPrice(price, mood),
        ability: def.ability ?? null,
        locked: moodLocked ?? locked,
        left,
      })),
      /** 背包里的东西卖给这家店给多少；0 是不收 */
      sell,
    };
  });
}
