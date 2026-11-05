import type { ViewContext } from "../../kernel/system";
import { RARITY_LABELS, type Rarity } from "../economy";
import {
  canDismantle,
  DISMANTLE_PARTS,
  itemCatalog,
  nextRarity,
  rarityOf,
  TUNE_PARTS,
  TUNE_TECH,
} from "./apply";
import {
  CLOTHING_SLOT_LABELS,
  ClothingSlotSchema,
  InventoryStateSchema,
  ITEM_KIND_LABELS,
  type ItemDef,
  loadoutSummary,
  MOD_SLOT_LABELS,
  ModSlotSchema,
  WEAPON_CATEGORY_LABELS,
  WEAPON_TYPE_LABELS,
  weaponSlotCost,
} from "./schema";

const CLOTHING_SLOTS = ClothingSlotSchema.options;
const MOD_SLOTS = ModSlotSchema.options;

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

/** 玩家看到的背包：武器格、快捷栏、背包、零件、服装、改装件、随身 6 格负荷与穿搭风格标签 */
export function inventoryView({ world, data }: ViewContext) {
  const inventory = InventoryStateSchema.parse(world.slices.inventory);
  const items = data.items === undefined ? new Map<string, ItemDef>() : itemCatalog(data);
  return {
    weapons: inventory.weapons,
    active: inventory.active,
    healing: inventory.healing,
    grenade: inventory.grenade,
    backpack: inventory.backpack,
    /** 3.0 随身 6 格负荷与四大穿搭通行证 */
    loadout: loadoutSummary(inventory, items),
    /** 随身物品的分类和说明；只投影持有的物品，供物品栏筛选和详情使用。 */
    details: Object.fromEntries(
      [
        ...new Set([
          ...inventory.weapons.filter((id): id is string => id !== null),
          ...Object.keys(inventory.backpack),
          ...Object.values(inventory.clothing),
          ...[inventory.healing, inventory.grenade].flatMap((slot) => (slot ? [slot.id] : [])),
        ]),
      ].flatMap((id) => {
        const def = items.get(id);
        if (!def) return [];
        const rar = def.rarity || def.kind === "weapon" ? rarityOf(def, inventory.tuned) : null;
        return [
          [
            id,
            {
              kind: def.kind,
              subLabel: itemSubLabel(def),
              rarity: rar,
              rarityLabel: def.iconic ? "不朽" : rar ? RARITY_LABELS[rar] : null,
              iconic: Boolean(def.iconic),
              slotCost: def.kind === "weapon" ? weaponSlotCost(def.category) : null,
              ability: def.ability ?? "",
              healPercent: def.healPercent ?? null,
              charges: def.charges ?? null,
              remaining: inventory.depleted[id] ?? def.charges ?? null,
            },
          ],
        ];
      }),
    ),
    /** 零件：拆解得来，给武器升稀有度 */
    parts: inventory.parts,
    /** 升过稀有度的武器：id → 稀有度名 */
    tuned: Object.fromEntries(
      Object.entries(inventory.tuned).map(([id, r]) => [id, RARITY_LABELS[r]]),
    ) as Readonly<Record<string, string>>,
    /** 身上武器（武器格和背包里的）现在的稀有度键，含升过的档；界面按它染原作稀有度色条 */
    rarity: Object.fromEntries(
      [
        ...new Set([
          ...inventory.weapons.filter((w): w is string => w !== null),
          ...Object.keys(inventory.backpack),
        ]),
      ].flatMap((id) => {
        const def = items.get(id);
        return def?.kind === "weapon" ? [[id, rarityOf(def, inventory.tuned)]] : [];
      }),
    ) as Readonly<Record<string, Rarity>>,
    /** 背包里能拆的东西各拆出几个零件 */
    dismantle: Object.fromEntries(
      Object.keys(inventory.backpack).flatMap((id) => {
        const def = items.get(id);
        return def && canDismantle(def)
          ? [[id, DISMANTLE_PARTS[rarityOf(def, inventory.tuned)]]]
          : [];
      }),
    ) as Readonly<Record<string, number>>,
    /** 身上的武器（武器格和背包里的）升一档：到哪一档、要几个零件、要多少技术；到顶的不列 */
    tune: Object.fromEntries(
      [
        ...new Set([
          ...inventory.weapons.filter((w): w is string => w !== null),
          ...Object.keys(inventory.backpack),
        ]),
      ].flatMap((id) => {
        const def = items.get(id);
        if (def?.kind !== "weapon") return [];
        const to = nextRarity(rarityOf(def, inventory.tuned));
        return to === null
          ? []
          : [[id, { to: RARITY_LABELS[to], parts: TUNE_PARTS[to], tech: TUNE_TECH[to] }]];
      }),
    ) as Readonly<Record<string, { to: string; parts: number; tech: number }>>,
    /** 穿着的服装，按格子顺序；没穿的格子不列 */
    clothing: CLOTHING_SLOTS.flatMap((slot) => {
      const id = inventory.clothing[slot];
      return id === undefined ? [] : [{ slot, label: CLOTHING_SLOT_LABELS[slot], id }];
    }),
    /** 存下的整套外观，按格子顺序；没存过时为空 */
    outfit: CLOTHING_SLOTS.flatMap((slot) => {
      const id = inventory.outfit[slot];
      return id === undefined ? [] : [{ slot, label: CLOTHING_SLOT_LABELS[slot], id }];
    }),
    /** 背包里每件东西能装到哪：weapon 武器格、quick 快捷栏、clothing 服装格；不能装的不列 */
    equipTo: Object.fromEntries(
      Object.keys(inventory.backpack).flatMap((id) => {
        const kind = items.get(id)?.kind;
        const to =
          kind === "weapon"
            ? "weapon"
            : kind === "healing" || kind === "grenade"
              ? "quick"
              : kind === "clothing"
                ? "clothing"
                : null;
        return to ? [[id, to]] : [];
      }),
    ) as Readonly<Record<string, "weapon" | "quick" | "clothing">>,
    /** 武器栏里带专属内心声音的不朽武器 */
    iconicVoices: inventory.weapons.flatMap((w) => {
      const def = w === null ? undefined : items.get(w);
      return def?.iconic && def.voice !== undefined
        ? [{ id: def.id, name: def.name, voice: def.voice }]
        : [];
    }),
    /** 武器上装着的改装件：武器 id → 按位置顺序；没装的武器不列 */
    mods: Object.fromEntries(
      Object.entries(inventory.mods).map(([weapon, fitted]) => [
        weapon,
        MOD_SLOTS.flatMap((slot) => {
          const id = fitted[slot];
          return id === undefined ? [] : [{ slot, label: MOD_SLOT_LABELS[slot], id }];
        }),
      ]),
    ) as Readonly<Record<string, readonly { slot: string; label: string; id: string }[]>>,
    /** 背包里的改装件能装到哪几把身上的武器（武器格和背包里的），按武器格在前 */
    modTargets: Object.fromEntries(
      Object.keys(inventory.backpack).flatMap((id) => {
        const fits = items.get(id)?.modFits;
        if (fits === undefined) return [];
        const owned = [
          ...new Set([
            ...inventory.weapons.filter((w): w is string => w !== null),
            ...Object.keys(inventory.backpack),
          ]),
        ];
        const targets = owned.filter((w) => {
          const category = items.get(w)?.category;
          return (
            items.get(w)?.kind === "weapon" && category !== undefined && fits.includes(category)
          );
        });
        return targets.length > 0 ? [[id, targets]] : [];
      }),
    ) as Readonly<Record<string, readonly string[]>>,
  };
}
