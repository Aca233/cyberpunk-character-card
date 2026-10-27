import type { ViewContext } from "../../kernel/system";
import { RARITY_LABELS } from "../economy";
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
  type ItemDef,
  MOD_SLOT_LABELS,
  ModSlotSchema,
} from "./schema";

const CLOTHING_SLOTS = ClothingSlotSchema.options;
const MOD_SLOTS = ModSlotSchema.options;

/** 玩家看到的背包：武器格、快捷栏、背包、零件、服装、改装件，以及能拆、能升、能装到哪 */
export function inventoryView({ world, data }: ViewContext) {
  const inventory = InventoryStateSchema.parse(world.slices.inventory);
  const items = data.items === undefined ? new Map<string, ItemDef>() : itemCatalog(data);
  return {
    weapons: inventory.weapons,
    active: inventory.active,
    healing: inventory.healing,
    grenade: inventory.grenade,
    backpack: inventory.backpack,
    /** 零件：拆解得来，给武器升稀有度 */
    parts: inventory.parts,
    /** 升过稀有度的武器：id → 稀有度名 */
    tuned: Object.fromEntries(
      Object.entries(inventory.tuned).map(([id, r]) => [id, RARITY_LABELS[r]]),
    ) as Readonly<Record<string, string>>,
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
