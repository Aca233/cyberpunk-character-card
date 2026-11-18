import { z } from "zod";
import type { ViewContext } from "../../kernel/system";
import { RARITY_LABELS, type Rarity } from "../economy";
import { itemCatalog, rarityOf, withWorldObjects } from "./apply";
import {
  CLOTHING_SLOT_LABELS,
  ClothingSlotSchema,
  canAttachMod,
  carriedItemCounts,
  carriedWeaponIds,
  defaultWeaponSlots,
  effectiveConcealment,
  effectiveWeaponNoise,
  InventoryStateSchema,
  ITEM_KIND_LABELS,
  type ItemDef,
  isBulkyItem,
  loadoutSummary,
  MOD_SLOT_LABELS,
  type ModSlot,
  ModSlotSchema,
  projectWeaponState,
  WEAPON_CATEGORY_LABELS,
  WEAPON_TYPE_LABELS,
  weaponGrantsSmartLink,
} from "./schema";

const CLOTHING_SLOTS = ClothingSlotSchema.options;
const MOD_SLOTS = ModSlotSchema.options;

/**
 * health 依赖 inventory，这里不反向引用 health / cyberware 的入口；
 * 只读取已安装与损坏的义体 id，计算随身大件上限（如钛金骨骼 +1）
 */
const InstalledChromeSliceSchema = z
  .object({ installed: z.array(z.object({ id: z.string() })).default([]) })
  .catch({ installed: [] });
const BrokenChromeSliceSchema = z
  .object({ brokenChrome: z.array(z.string()).default([]) })
  .catch({ brokenChrome: [] });

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

/** 玩家看到的背包：统一随身背包与武器、快捷栏、服装、改装件及随身大件统计 */
export function inventoryView({ world, data }: ViewContext) {
  const inventory = InventoryStateSchema.parse(world.slices.inventory);
  const items =
    data.items === undefined
      ? new Map<string, ItemDef>()
      : itemCatalog(withWorldObjects(data, inventory.objects));
  const counts = carriedItemCounts(inventory);
  const weaponIds = carriedWeaponIds(inventory, items);
  const cyber = InstalledChromeSliceSchema.parse(world.slices.cyberware ?? {});
  const health = BrokenChromeSliceSchema.parse(world.slices.health ?? {});
  const loadout = loadoutSummary(inventory, items, {
    installed: cyber.installed,
    brokenChrome: health.brokenChrome,
  });

  return {
    healing: inventory.healing,
    grenade: inventory.grenade,
    /** 统一后的随身背包，数量均在此展示 */
    backpack: Object.fromEntries(counts) as Readonly<Record<string, number>>,
    /** 随身携带的武器列表（含基础模板 ID、改装态、有效隐蔽度与声学标签），用于 HUD 展示与模型状态 */
    carriedWeapons: weaponIds.map((id) => {
      const obj = inventory.objects[id];
      const def = items.get(id) ?? obj?.definition;
      const baseId = obj?.weaponState?.baseId ?? id;
      const ws = obj?.weaponState;
      return {
        id,
        baseId,
        count: counts.get(id) ?? 1,
        weaponType: def?.weaponType ?? null,
        isRanged:
          def?.kind === "weapon" &&
          def.category !== undefined &&
          def.category !== "blade" &&
          def.category !== "blunt",
        bulky: isBulkyItem(def, baseId),
        concealment: def ? effectiveConcealment(def, ws, items) : ("pocket" as const),
        noise: def ? effectiveWeaponNoise(def, ws, items) : ("loud" as const),
        grantsSmartLink: def ? weaponGrantsSmartLink(def, ws, items) : false,
        weaponState: projectWeaponState(ws),
      };
    }),
    /** 随身大件负荷（2 起步，承重骨骼 +1，超出时软超重） */
    bulky: {
      count: loadout.bulkyCount,
      max: loadout.bulkyMax,
      overloaded: loadout.bulkyOverloaded,
    },
    /** 随身大件与隐蔽度统计 */
    loadout,
    /** 随身物品的分类和说明；只投影持有的物品，供物品栏筛选和详情使用。 */
    details: Object.fromEntries(
      [
        ...new Set([
          ...counts.keys(),
          ...Object.values(inventory.clothing),
          ...[inventory.healing, inventory.grenade].flatMap((slot) => (slot ? [slot.id] : [])),
        ]),
      ].flatMap((id) => {
        const obj = inventory.objects[id];
        const def = items.get(id) ?? obj?.definition;
        if (!def) return [];
        const ws = obj?.weaponState;
        const baseId = ws?.baseId ?? id;
        const rar = def.rarity || def.kind === "weapon" ? rarityOf(def, ws) : null;
        return [
          [
            id,
            {
              baseId,
              kind: def.kind,
              subLabel: itemSubLabel(def),
              rarity: rar,
              rarityLabel: def.iconic ? "不朽" : rar ? RARITY_LABELS[rar] : null,
              iconic: Boolean(def.iconic),
              bulky: isBulkyItem(def, baseId),
              concealment: def.kind === "weapon" ? effectiveConcealment(def, ws, items) : null,
              noise: def.kind === "weapon" ? effectiveWeaponNoise(def, ws, items) : null,
              grantsSmartLink:
                def.kind === "weapon" ? weaponGrantsSmartLink(def, ws, items) : false,
              modSlots:
                def.kind === "weapon" ? defaultWeaponSlots(def) : ([] as readonly ModSlot[]),
              weaponState: projectWeaponState(ws),
              ability: def.ability ?? "",
              healPercent: def.healPercent ?? null,
              charges: def.charges ?? null,
              remaining: inventory.depleted[id] ?? def.charges ?? null,
            },
          ],
        ];
      }),
    ),
    /** 身上武器现在的稀有度键，含精调升阶后的档；界面按它染原作稀有度色条 */
    rarity: Object.fromEntries(
      weaponIds.flatMap((id) => {
        const obj = inventory.objects[id];
        const def = items.get(id) ?? obj?.definition;
        return def?.kind === "weapon" ? [[id, rarityOf(def, obj?.weaponState)]] : [];
      }),
    ) as Readonly<Record<string, Rarity>>,
    /** 穿着的服装，按格子顺序；没穿的格子不列 */
    clothing: CLOTHING_SLOTS.flatMap((slot) => {
      const id = inventory.clothing[slot];
      return id === undefined ? [] : [{ slot, label: CLOTHING_SLOT_LABELS[slot], id }];
    }),
    /** 背包里每件东西能装到哪：quick 快捷栏、clothing 服装格；武器直接放背包使用不再单装 */
    equipTo: Object.fromEntries(
      [...counts.keys()].flatMap((id) => {
        const kind = items.get(id)?.kind;
        const to =
          kind === "healing" || kind === "grenade"
            ? "quick"
            : kind === "clothing"
              ? "clothing"
              : null;
        return to ? [[id, to]] : [];
      }),
    ) as Readonly<Record<string, "quick" | "clothing">>,
    /** 武器上装着的改装件：武器 id → 按位置顺序；没装的武器不列 */
    mods: Object.fromEntries(
      weaponIds.flatMap((weaponId) => {
        const ws = inventory.objects[weaponId]?.weaponState;
        if (!ws) return [];
        const entries = MOD_SLOTS.flatMap((slot) => {
          const id = ws.mods[slot];
          if (id === undefined) return [];
          const modDef = items.get(id);
          return [
            {
              slot,
              label: MOD_SLOT_LABELS[slot],
              id,
              name: modDef?.name ?? id,
              ability: modDef?.ability ?? "",
              locked: ws.lockedSlots.includes(slot),
            },
          ];
        });
        return entries.length > 0 ? [[weaponId, entries]] : [];
      }),
    ) as Readonly<
      Record<
        string,
        readonly {
          slot: string;
          label: string;
          id: string;
          name: string;
          ability: string;
          locked: boolean;
        }[]
      >
    >,
    /** 背包里的改装件能装到哪几把随身武器上 */
    modTargets: Object.fromEntries(
      [...counts.keys()].flatMap((id) => {
        const modDef = items.get(id);
        if (modDef?.kind !== "mod") return [];
        const targets = weaponIds.filter((w) => {
          const obj = inventory.objects[w];
          const weaponDef = items.get(w) ?? obj?.definition;
          return weaponDef !== undefined && canAttachMod(weaponDef, modDef, obj?.weaponState).ok;
        });
        return targets.length > 0 ? [[id, targets]] : [];
      }),
    ) as Readonly<Record<string, readonly string[]>>,
  };
}
