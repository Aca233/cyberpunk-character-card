import { z } from "zod";
import type { ViewContext } from "../../kernel/system";
import { RARITY_LABELS, type Rarity } from "../economy";
import { itemCatalog, rarityOf, withWorldObjects } from "./apply";
import {
  availableQuickSupply,
  CLOTHING_SLOT_LABELS,
  CLOTHING_STYLE_LABELS,
  ClothingSlotSchema,
  canAttachMod,
  carriedHeldWeaponIds,
  carriedItemCounts,
  carriedWeaponIds,
  defaultWeaponSlots,
  effectiveConcealment,
  effectiveWeaponNoise,
  InventoryStateSchema,
  ITEM_KIND_LABELS,
  type ItemDef,
  isBulkyItem,
  itemCarryUnits,
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

function carryBonusCatalog(
  data: Readonly<Record<string, unknown>>,
): ReadonlyMap<string, { readonly carryBonus?: number | undefined }> {
  const map = new Map<string, { readonly carryBonus?: number | undefined }>();
  if (!Array.isArray(data.cyberware)) return map;
  for (const raw of data.cyberware) {
    if (
      typeof raw === "object" &&
      raw !== null &&
      typeof (raw as { id?: unknown }).id === "string" &&
      typeof (raw as { carryBonus?: unknown }).carryBonus === "number"
    ) {
      map.set((raw as { id: string }).id, {
        carryBonus: (raw as { carryBonus: number }).carryBonus,
      });
    }
  }
  return map;
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

function buildChipBraindanceIds(
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

type NeuralGroup = "bd-device" | "chip-device" | "bd-carrier" | "chip" | null;

function neuralGroupOf(def: ItemDef, bdChipIds: ReadonlySet<string>): NeuralGroup {
  if (def.braindanceDevice?.playback) return "bd-device";
  if (def.chipDevice) return "chip-device";
  if (def.chipContentId && bdChipIds.has(def.chipContentId)) return "bd-carrier";
  if (def.chipContentId || def.chipStorage) return "chip";
  return null;
}

function itemSubLabel(def: ItemDef, neuralGroup: NeuralGroup): string {
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
    catalog: carryBonusCatalog(data),
  });
  const bdChipIds = buildChipBraindanceIds(world, data);
  let suppressantCount = 0;
  for (const [id, count] of counts) {
    const def = items.get(id) ?? inventory.objects[id]?.definition;
    if (def?.suppressant) suppressantCount += count;
  }

  return {
    healing: inventory.healing,
    grenade: inventory.grenade,
    quickSupplyAvailable: {
      healing: availableQuickSupply(inventory, "healing") !== null,
      grenade: availableQuickSupply(inventory, "grenade") !== null,
    },
    /** 统一后的随身背包，数量均在此展示 */
    backpack: Object.fromEntries(counts) as Readonly<Record<string, number>>,
    /** 随身可用的神经压制剂总数（按 ItemDef.suppressant 汇总） */
    suppressantCount,
    heldWeapons: carriedHeldWeaponIds(inventory, items),
    /** 随身携带的武器列表（含基础模板 ID、改装态、有效隐蔽度与声学标签），用于 HUD 展示与模型状态 */
    carriedWeapons: weaponIds.map((id) => {
      const obj = inventory.objects[id];
      const def = items.get(id) ?? obj?.definition;
      const baseId = obj?.weaponState?.baseId ?? id;
      const baseDef = baseId !== id ? items.get(baseId) : undefined;
      const resolvedDef =
        def && def.concealment === undefined && baseDef?.concealment !== undefined
          ? { ...def, concealment: baseDef.concealment }
          : def;
      const ws = obj?.weaponState;
      return {
        id,
        baseId,
        count: counts.get(id) ?? 1,
        category: def?.category ?? null,
        rarity: def ? rarityOf(def) : null,
        iconic: Boolean(def?.iconic),
        weaponType: def?.weaponType ?? null,
        isRanged:
          def?.kind === "weapon" &&
          def.category !== undefined &&
          def.category !== "blade" &&
          def.category !== "blunt",
        bulky: isBulkyItem(resolvedDef),
        concealment: resolvedDef
          ? effectiveConcealment(resolvedDef, ws, items)
          : ("pocket" as const),
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
        const baseId = ws?.baseId ?? obj?.baseId ?? id;
        const baseDef = baseId !== id ? items.get(baseId) : undefined;
        const resolvedDef =
          def.concealment === undefined && baseDef?.concealment !== undefined
            ? { ...def, concealment: baseDef.concealment }
            : def;
        const rar = def.rarity || def.kind === "weapon" ? rarityOf(def) : null;
        const neuralGroup = neuralGroupOf(def, bdChipIds);
        return [
          [
            id,
            {
              baseId,
              kind: def.kind,
              suppressant: Boolean(def.suppressant),
              clothingSlot: def.kind === "clothing" ? (def.clothingSlot ?? null) : null,
              subLabel: itemSubLabel(def, neuralGroup),
              neuralGroup,
              chipContentId: def.chipContentId ?? null,
              chipDevice: def.chipDevice ?? null,
              chipStorage: Boolean(def.chipStorage),
              braindanceDevice: def.braindanceDevice ?? null,
              rarity: rar,
              rarityLabel: def.iconic ? "不朽" : rar ? RARITY_LABELS[rar] : null,
              iconic: Boolean(def.iconic),
              bulky: isBulkyItem(resolvedDef),
              carryUnits: itemCarryUnits(resolvedDef),
              concealment:
                def.kind === "weapon" ? effectiveConcealment(resolvedDef, ws, items) : null,
              noise: def.kind === "weapon" ? effectiveWeaponNoise(def, ws, items) : null,
              grantsSmartLink:
                def.kind === "weapon" ? weaponGrantsSmartLink(def, ws, items) : false,
              modSlots:
                def.kind === "weapon" ? defaultWeaponSlots(def) : ([] as readonly ModSlot[]),
              weaponState: projectWeaponState(ws),
              ability: def.ability ?? "",
              healPercent: def.healPercent ?? null,
              charges: def.charges ?? null,
              remaining: obj?.remaining ?? def.charges ?? null,
            },
          ],
        ];
      }),
    ),
    /** 身上武器现在的稀有度键；界面按它染原作稀有度色条 */
    rarity: Object.fromEntries(
      weaponIds.flatMap((id) => {
        const obj = inventory.objects[id];
        const def = items.get(id) ?? obj?.definition;
        return def?.kind === "weapon" ? [[id, rarityOf(def)]] : [];
      }),
    ) as Readonly<Record<string, Rarity>>,
    /** 穿着的服装，按格子顺序；没穿的格子不列 */
    clothing: CLOTHING_SLOTS.flatMap((slot) => {
      const id = inventory.clothing[slot];
      if (id === undefined) return [];
      const def = items.get(id);
      return [
        {
          slot,
          label: CLOTHING_SLOT_LABELS[slot],
          id,
          style: def?.clothingStyle ?? null,
          styleLabel: def?.clothingStyle ? CLOTHING_STYLE_LABELS[def.clothingStyle] : null,
          concealsCoatWeapon: Boolean(def?.concealsCoatWeapon),
        },
      ];
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
