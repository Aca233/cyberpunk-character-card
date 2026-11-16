import type { ViewContext } from "../../kernel/system";
import { locationCatalog, WorldClockStateSchema } from "../world";
import { itemCatalog } from "./apply";
import { carriedItemCounts, InventoryStateSchema, type ItemDef } from "./schema";

const CJK = /[㐀-鿿]/;

/** 物品和地点的中文名；表外的物品用 id，表外的地点只有本身是中文时才当名字 */
export function namesView({ world, data }: ViewContext) {
  const inventory = InventoryStateSchema.parse(world.slices.inventory);
  const { location } = WorldClockStateSchema.parse(world.slices.world);
  const items = data.items === undefined ? new Map<string, ItemDef>() : itemCatalog(data);
  const ids = new Set([
    ...carriedItemCounts(inventory).keys(),
    ...(inventory.healing ? [inventory.healing.id] : []),
    ...(inventory.grenade ? [inventory.grenade.id] : []),
    ...Object.values(inventory.clothing),
  ]);
  const place = location === null ? undefined : locationCatalog(data).get(location);
  return {
    items: Object.fromEntries([...ids].map((id) => [id, items.get(id)?.name ?? id])),
    location: place?.name ?? (location !== null && CJK.test(location) ? location : null),
    district: place?.district ?? null,
  };
}
