import { z } from "zod";
import type { ViewContext } from "../../kernel/system";
import { type CyberwareDef, CyberwareStateSchema, cyberwareCatalog } from "../cyberware";
import { RARITY_LABELS, type Rarity } from "../economy";
import {
  CLOTHING_SLOT_LABELS,
  formatWeaponWithMods,
  InventoryStateSchema,
  ITEM_KIND_LABELS,
  type ItemDef,
  type ItemKind,
  itemCarryUnits,
  itemCatalog,
  MOD_SLOT_LABELS,
  rarityOf,
  WEAPON_CATEGORY_LABELS,
  WEAPON_TYPE_LABELS,
  weaponDisplayNames,
  withWorldObjects,
} from "../inventory";
import { formatGameTime, locationCatalog, WorldClockStateSchema } from "../world";
import { apartmentAt, apartmentList, apartmentLocked, homeAt } from "./apply";
import { RENT_REMIND_BEFORE_DAYS, SafehouseStateSchema } from "./schema";
import { ownStorageTargets, type StorageTarget } from "./storage";

export type StoredNeuralGroup = "bd-device" | "chip-device" | "bd-carrier" | "chip" | null;

export interface StoredItem {
  readonly id: string;
  readonly name: string;
  readonly baseId: string | null;
  readonly count: number;
  readonly kind: ItemKind;
  readonly subLabel: string;
  readonly neuralGroup: StoredNeuralGroup;
  readonly rarity: Rarity | null;
  readonly rarityLabel: string | null;
  readonly iconic: boolean;
  readonly carryUnits: number;
  readonly ability: string | null;
  readonly remaining: number | null;
  readonly charges: number | null;
}

export interface StorageGroup extends StorageTarget {
  readonly items: StoredItem[];
}

const ChipCategoryIndexSchema = z
  .array(
    z.object({
      id: z.string(),
      category: z.string().optional(),
      braindance: z.string().optional(),
    }),
  )
  .catch([]);

function buildBraindanceChipIds(
  world: ViewContext["world"],
  data: ViewContext["data"],
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const row of ChipCategoryIndexSchema.parse(data.chipContents ?? [])) {
    if (row.category === "braindance" || row.braindance) ids.add(row.id);
  }
  const slice = world.slices.shards as
    | { contents?: Record<string, { id?: string; category?: string; braindance?: string }> }
    | undefined;
  for (const row of Object.values(slice?.contents ?? {})) {
    if (row?.id && (row.category === "braindance" || row.braindance)) ids.add(row.id);
  }
  return ids;
}

function neuralGroupOf(
  def: ItemDef | undefined,
  bdChipIds: ReadonlySet<string>,
): StoredNeuralGroup {
  if (!def) return null;
  if (def.braindanceDevice?.playback) return "bd-device";
  if (def.chipDevice) return "chip-device";
  if (def.chipContentId && bdChipIds.has(def.chipContentId)) return "bd-carrier";
  if (def.chipContentId || def.chipStorage) return "chip";
  return null;
}

function subLabelOf(def: ItemDef | undefined, neuralGroup: StoredNeuralGroup): string {
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
  if (neuralGroup === "bd-device") {
    return (def.braindanceDevice?.analysis.length ?? 0) > 0 ? "超梦编辑头环" : "超梦花环";
  }
  if (neuralGroup === "chip-device") {
    return def.chipDevice === "reader-writer" ? "隔离读写器" : "芯片阅读器";
  }
  if (neuralGroup === "bd-carrier") return "超梦卷轴";
  if (neuralGroup === "chip") return def.chipContentId ? "神经芯片" : "空白存储芯片";
  return ITEM_KIND_LABELS[def.kind];
}

function storageGroups({ world, data }: Pick<ViewContext, "world" | "data">): StorageGroup[] {
  const inventory = InventoryStateSchema.parse(world.slices.inventory);
  const extended = withWorldObjects(data, inventory.objects);
  const items = Array.isArray(extended.items) ? itemCatalog(extended) : new Map<string, ItemDef>();
  const bdChipIds = buildBraindanceChipIds(world, data);
  const places = locationCatalog(data);
  const cyber = CyberwareStateSchema.parse(world.slices.cyberware ?? {});
  const chrome =
    data.cyberware !== undefined ? cyberwareCatalog(data) : new Map<string, CyberwareDef>();
  const npcs = (world.slices.npc as { npcs?: Record<string, { name: string }> } | undefined)?.npcs;
  const groups = new Map<string, StorageGroup>(
    ownStorageTargets(world, data).map((target) => [target.key, { ...target, items: [] }]),
  );
  const names = weaponDisplayNames(
    [...Object.keys(inventory.backpack), ...inventory.placed.map((entry) => entry.item)],
    inventory.objects,
    items,
  );

  const ensureGroup = (kind: StorageGroup["kind"], target: string, location: string | null) => {
    const key = `${kind}:${target}`;
    let group = groups.get(key);
    if (!group) {
      const locationName =
        location === null ? "位置未知" : (places.get(location)?.name ?? location);
      group = {
        key,
        kind,
        target,
        name:
          kind === "npc"
            ? `${npcs?.[target]?.name ?? "他人"}保管`
            : kind === "home"
              ? "原住处留存"
              : kind === "vehicle"
                ? "原车辆留存"
                : (places.get(target)?.name ?? locationName),
        locationName,
        canStore: false,
        canTake: false,
        blockedReason: "此处留置物品请通过行动说明交接与取回",
        items: [],
      };
      groups.set(key, group);
    }
    return group;
  };

  for (const entry of inventory.placed) {
    const group = ensureGroup(entry.kind, entry.target, entry.location);
    const existing = group.items.find((item) => item.id === entry.item);
    if (existing) {
      const index = group.items.indexOf(existing);
      group.items[index] = { ...existing, count: existing.count + entry.count };
      continue;
    }
    const object = inventory.objects[entry.item];
    const def = items.get(entry.item) ?? object?.definition;
    const rarity = def && (def.rarity || def.kind === "weapon") ? rarityOf(def) : null;
    const baseId = object?.weaponState?.baseId ?? object?.baseId ?? def?.id ?? null;
    const neuralGroup = neuralGroupOf(def, bdChipIds);
    group.items.push({
      id: entry.item,
      name: formatWeaponWithMods(
        names.get(entry.item) ?? def?.name ?? entry.item,
        object?.weaponState,
        items,
      ),
      baseId,
      count: entry.count,
      kind: def?.kind ?? "misc",
      subLabel: subLabelOf(def, neuralGroup),
      neuralGroup,
      rarity,
      rarityLabel: def?.iconic ? "不朽" : rarity ? RARITY_LABELS[rarity] : null,
      iconic: Boolean(def?.iconic),
      carryUnits: def ? itemCarryUnits(def) : 0,
      ability: def?.ability ?? null,
      remaining: object?.remaining ?? def?.charges ?? null,
      charges: def?.charges ?? null,
    });
  }

  for (const part of Object.values(cyber.parts)) {
    if (part.condition === "scrapped") continue;
    const colon = part.holder.indexOf(":");
    if (colon < 0) continue;
    const kind = part.holder.slice(0, colon);
    if (kind !== "home" && kind !== "vehicle" && kind !== "place") continue;
    const target = part.holder.slice(colon + 1);
    const group = ensureGroup(kind, target, part.location);
    if (group.items.some((item) => item.id === part.id)) continue;
    const def = chrome.get(part.model);
    const rarity = def?.rarity ?? null;
    group.items.push({
      id: part.id,
      name: `${def?.name ?? part.model}（未安装${part.condition === "damaged" ? "·损坏" : ""}）`,
      baseId: part.id,
      count: 1,
      kind: "misc",
      subLabel: "义体实物",
      neuralGroup: null,
      rarity,
      rarityLabel: rarity ? RARITY_LABELS[rarity] : null,
      iconic: Boolean(def?.iconic),
      carryUnits: 0,
      ability: [def?.ability, `来源：${part.source}`, "取回后可携带或交给医生检查安装。"]
        .filter(Boolean)
        .join("\n"),
      remaining: null,
      charges: null,
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
    homes: state.homes.map((h) => {
      const rentDue =
        h.tenure === "rented" &&
        h.rentPaidUntil !== undefined &&
        world.time >= h.rentPaidUntil - RENT_REMIND_BEFORE_DAYS * 1440;
      return {
        id: h.id,
        name: h.name,
        location: h.location,
        locationName: places.get(h.location)?.name ?? h.location,
        here: homeAt(h, location, data),
        tenure: h.tenure,
        rentAmount: h.tenure === "rented" ? (h.rentAmount ?? 1200) : null,
        rentPaidUntil:
          h.tenure === "rented" && h.rentPaidUntil !== undefined
            ? formatGameTime(h.rentPaidUntil)
            : null,
        rentDue,
        locked: h.locked,
      };
    }),
    /** 当前地点能买下的公寓；locked 是买不了的原因（已经有住处），钱够不够由界面比 */
    forSale: apartmentList(data)
      .filter((a) => apartmentAt(a, location))
      .map((a) => ({
        id: a.id,
        name: a.name,
        price: a.price,
        note: a.note,
        locked: apartmentLocked(state.homes, a) ?? null,
      })),
  };
}
