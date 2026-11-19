import type { ViewContext } from "../../kernel/system";
import { RARITY_LABELS, type Rarity } from "../economy";
import {
  CLOTHING_SLOT_LABELS,
  formatWeaponWithMods,
  InventoryStateSchema,
  ITEM_KIND_LABELS,
  type ItemDef,
  type ItemKind,
  itemCatalog,
  MOD_SLOT_LABELS,
  rarityOf,
  WEAPON_CATEGORY_LABELS,
  WEAPON_TYPE_LABELS,
  weaponDisplayNames,
  withWorldObjects,
} from "../inventory";
import { locationCatalog, WorldClockStateSchema } from "../world";
import { apartmentList, apartmentLocked } from "./apply";
import { SafehouseStateSchema } from "./schema";
import { ownStorageTargets, type StorageTarget } from "./storage";

export interface StoredItem {
  readonly id: string;
  readonly name: string;
  readonly baseId: string | null;
  readonly count: number;
  readonly kind: ItemKind;
  readonly subLabel: string;
  readonly rarity: Rarity | null;
  readonly rarityLabel: string | null;
  readonly iconic: boolean;
  readonly ability: string | null;
  readonly remaining: number | null;
  readonly charges: number | null;
}

export interface StorageGroup extends StorageTarget {
  readonly items: StoredItem[];
}

function subLabelOf(def: ItemDef | undefined): string {
  if (!def) return "未登记物品";
  if (def.kind === "weapon") {
    return [
      def.weaponType ? WEAPON_TYPE_LABELS[def.weaponType] : null,
      def.category ? WEAPON_CATEGORY_LABELS[def.category] : null,
    ]
      .filter(Boolean)
      .join("");
  }
  if (def.kind === "clothing" && def.clothingSlot) return CLOTHING_SLOT_LABELS[def.clothingSlot];
  if (def.kind === "mod" && def.modSlot) return `改装 · ${MOD_SLOT_LABELS[def.modSlot]}`;
  return ITEM_KIND_LABELS[def.kind];
}

function storageGroups({ world, data }: Pick<ViewContext, "world" | "data">): StorageGroup[] {
  const inventory = InventoryStateSchema.parse(world.slices.inventory);
  const extended = withWorldObjects(data, inventory.objects);
  const items = Array.isArray(extended.items) ? itemCatalog(extended) : new Map<string, ItemDef>();
  const places = locationCatalog(data);
  const npcs = (world.slices.npc as { npcs?: Record<string, { name: string }> } | undefined)?.npcs;
  const groups = new Map<string, StorageGroup>(
    ownStorageTargets(world, data).map((target) => [target.key, { ...target, items: [] }]),
  );
  const names = weaponDisplayNames(
    [...Object.keys(inventory.backpack), ...inventory.placed.map((entry) => entry.item)],
    inventory.objects,
    items,
  );

  for (const entry of inventory.placed) {
    const key = `${entry.kind}:${entry.target}`;
    let group = groups.get(key);
    if (!group) {
      const locationName =
        entry.location === null ? "位置未知" : (places.get(entry.location)?.name ?? entry.location);
      group = {
        key,
        kind: entry.kind,
        target: entry.target,
        name:
          entry.kind === "npc"
            ? `${npcs?.[entry.target]?.name ?? "他人"}保管`
            : entry.kind === "home"
              ? "原住处留存"
              : entry.kind === "vehicle"
                ? "原车辆留存"
                : (places.get(entry.target)?.name ?? locationName),
        locationName,
        canStore: false,
        canTake: false,
        blockedReason: "此处留置物品请通过行动说明交接与取回",
        items: [],
      };
      groups.set(key, group);
    }
    const existing = group.items.find((item) => item.id === entry.item);
    if (existing) {
      const index = group.items.indexOf(existing);
      group.items[index] = { ...existing, count: existing.count + entry.count };
      continue;
    }
    const object = inventory.objects[entry.item];
    const def = items.get(entry.item) ?? object?.definition;
    const rarity = def && (def.rarity || def.kind === "weapon") ? rarityOf(def) : null;
    group.items.push({
      id: entry.item,
      name: formatWeaponWithMods(
        names.get(entry.item) ?? def?.name ?? entry.item,
        object?.weaponState,
        items,
      ),
      baseId: object?.weaponState?.baseId ?? object?.baseId ?? def?.id ?? null,
      count: entry.count,
      kind: def?.kind ?? "misc",
      subLabel: subLabelOf(def),
      rarity,
      rarityLabel: def?.iconic ? "不朽" : rarity ? RARITY_LABELS[rarity] : null,
      iconic: Boolean(def?.iconic),
      ability: def?.ability ?? null,
      remaining: object?.remaining ?? def?.charges ?? null,
      charges: def?.charges ?? null,
    });
  }
  return [...groups.values()];
}

/** 供叙事状态和界面读取的住所与当前地点可买的公寓 */
export function safehouseView({ world, data }: ViewContext) {
  const { location } = WorldClockStateSchema.parse(world.slices.world);
  const state = SafehouseStateSchema.parse(world.slices.safehouse ?? {});
  const places = locationCatalog(data);
  return {
    /** 存放位置独立分组；远处、人物或场景交接只能查看，不提供远程存取。 */
    storage: storageGroups({ world, data }),
    homes: state.homes.map((h) => ({
      id: h.id,
      name: h.name,
      location: h.location,
      locationName: places.get(h.location)?.name ?? h.location,
      here: h.location === location,
    })),
    /** 当前地点能买下的公寓；locked 是买不了的原因（已经有住处），钱够不够由界面比 */
    forSale: apartmentList(data)
      .filter((a) => a.location === location)
      .map((a) => ({
        id: a.id,
        name: a.name,
        price: a.price,
        note: a.note,
        locked: apartmentLocked(state.homes, a) ?? null,
      })),
  };
}
