import { inventoryRules } from "@cp/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActionButton } from "../../ui/ActionButton";
import { Asset, cssUrl, NineSlice } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { CellFrame, FrameBox } from "../../ui/FrameBox";
import { useLayer } from "../../ui/layers";
import { baseWeaponIdOf, itemArtOf } from "./art";
import mediaStyles from "./content-media.module.css";
import type { PlaceInventoryItem } from "./InventoryStorage";
import styles from "./inventory.module.css";
import { UnreadBadge } from "./Phone";
import { vehicleArtOf } from "./vehicle-art";
import {
  CONCEALMENT_LABELS,
  displayItemName,
  NOISE_LABELS,
  type View,
  woundTelemetry,
} from "./view";
import { type ShopModMeta, WeaponSlotInspector } from "./WeaponSlotInspector";

/** 物品格九宫格切法，同四角在场的人用的 map.filterCell* */
const CELL_SLICE = [20, 30, 30, 20] as const;

export type InventoryFilter =
  | "all"
  | "usable"
  | "weapon"
  | "clothing"
  | "mod"
  | "neural"
  | "vehicle"
  | "misc";

type InventorySort = "default" | "rarity" | "kind" | "carry";

const SORT_LABELS: Readonly<Record<InventorySort, string>> = {
  default: "默认",
  rarity: "品质",
  kind: "类型",
  carry: "负担",
};

const SORT_CYCLE: readonly InventorySort[] = ["default", "rarity", "kind", "carry"];

const RARITY_RANK: Readonly<Record<string, number>> = {
  legendary: 5,
  epic: 4,
  rare: 3,
  uncommon: 2,
  common: 1,
};

const KIND_RANK: Readonly<Record<string, number>> = {
  weapon: 1,
  healing: 2,
  grenade: 3,
  consumable: 4,
  clothing: 5,
  mod: 6,
  misc: 7,
  vehicle: 8,
};

type VehicleView = View["travel"]["vehicles"][number];

type InventoryEntry =
  | {
      readonly entryType: "item";
      readonly key: string;
      readonly id: string;
      readonly count: number;
      readonly worn: boolean;
      readonly slot?: inventoryRules.ClothingSlot | undefined;
    }
  | {
      readonly entryType: "vehicle";
      readonly key: string;
      readonly id: string;
      readonly vehicle: VehicleView;
    };

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.closest("input, textarea, select") !== null)
  );
}

/**
 * 随身物品栏（O）：计数筛选/排序/搜索 + 全高双栏独立滚动 + 键盘快操。
 * 已穿服装置顶并标注「已穿」；名下车辆并入条目与「车辆」筛选并支持直达后备箱；
 * 个人神经芯片槽统一展示在展开的生物检测面板顶部；
 * 一级页签（随身 / 存放）与携带负担刻度由外层 Weapon 展开顶栏统一承载。
 */
export function InventoryPage({
  view,
  storageKey,
  onSelectStorage,
  onOpenStorage,
  initialFocus,
  onEquip,
  onUnequip,
  onMod,
  onBuyHome,
  onHeal,
  onSuppressant,
  onUse,
  onActionDraft,
  onPlaceItem,
  disabledReason,
}: {
  readonly view: View;
  readonly storageKey: string | null;
  readonly onSelectStorage: (key: string) => void;
  /** 从车辆条目直达对应后备箱的存放视图 */
  readonly onOpenStorage?: ((storageKey: string) => void) | undefined;
  /** 从其他面板（如生物检测的神经芯片槽）跳入时的预设筛选与定位物品 */
  readonly initialFocus?:
    | { readonly filter?: InventoryFilter; readonly itemId?: string; readonly nonce: number }
    | null
    | undefined;
  /** 非战斗治疗和压制剂直接结算；情境性使用交给行动输入，由玩家确认。 */
  readonly onHeal?: ((id: string) => Promise<void>) | undefined;
  readonly onSuppressant?: (() => Promise<void>) | undefined;
  readonly onUse?: ((id: string) => void) | undefined;
  /** 将芯片/超梦等自由行动填入行动输入框，由玩家确认后提交。 */
  readonly onActionDraft?: ((text: string) => void) | undefined;
  /** 在当前地点的自有住所或车辆中，每次存入或取回一件物品。 */
  readonly onPlaceItem?: PlaceInventoryItem | undefined;
  readonly disabledReason?: string | undefined;
  /** 换服装或快捷药剂/手雷；正在生成或战斗中时不传 */
  readonly onEquip?: ((id: string) => void) | undefined;
  readonly onUnequip?: ((id: string) => void) | undefined;
  /** 改装件：attach 从背包装到武器上，detach 拆下放回背包 */
  readonly onMod?: ((action: "attach" | "detach", weapon: string, mod: string) => void) | undefined;
  /** 买下当前地点的一处公寓；正在生成时不传 */
  readonly onBuyHome?: ((id: string) => void) | undefined;
}) {
  const { inventory } = view;
  const quickItems = useMemo(
    () => [inventory.healing, inventory.grenade].flatMap((item) => (item ? [item] : [])),
    [inventory.healing, inventory.grenade],
  );
  const carried = useMemo(() => {
    const next: Record<string, number> = { ...inventory.backpack };
    for (const item of quickItems) next[item.id] = (next[item.id] ?? 0) + 1;
    return next;
  }, [inventory.backpack, quickItems]);

  const carriedChipById = useMemo(
    () => new Map(view.shards.carried.map((chip) => [chip.carrier, chip])),
    [view.shards.carried],
  );
  const storageByKey = useMemo(
    () => new Map(view.safehouse.storage.map((group) => [group.key, group])),
    [view.safehouse.storage],
  );

  const [filter, setFilter] = useState<InventoryFilter>(() => initialFocus?.filter ?? "all");
  const [sort, setSort] = useState<InventorySort>("default");
  const [search, setSearch] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [pickedItem, setPickedItem] = useState<{
    id: string;
    worn?: boolean;
    entryType?: "item" | "vehicle";
    fallbackIndex?: number;
  } | null>(() =>
    initialFocus?.itemId ? { id: initialFocus.itemId, worn: false, entryType: "item" } : null,
  );

  useEffect(() => {
    if (!initialFocus) return;
    if (initialFocus.filter) setFilter(initialFocus.filter);
    if (initialFocus.itemId) {
      setPickedItem({ id: initialFocus.itemId, worn: false, entryType: "item" });
      setSearch("");
    }
  }, [initialFocus]);
  const [openSlotPicker, setOpenSlotPicker] = useState<{
    weaponId: string;
    slot: inventoryRules.ModSlot;
  } | null>(null);
  const [usingItem, setUsingItem] = useState(false);
  const actionPending = useRef(false);
  const [useError, setUseError] = useState("");
  const [receipt, setReceipt] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const receiptTimer = useRef<number | undefined>(undefined);
  const flashTimer = useRef<number | undefined>(undefined);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const showReceipt = useCallback((message: string, itemId?: string) => {
    window.clearTimeout(receiptTimer.current);
    setReceipt(message);
    receiptTimer.current = window.setTimeout(() => setReceipt(null), 2200);
    if (itemId) {
      window.clearTimeout(flashTimer.current);
      setFlashId(itemId);
      flashTimer.current = window.setTimeout(() => setFlashId(null), 400);
    }
  }, []);

  useEffect(() => {
    return () => {
      window.clearTimeout(receiptTimer.current);
      window.clearTimeout(flashTimer.current);
    };
  }, []);

  const isUsable = useCallback(
    (id: string) => {
      const kind = inventory.details?.[id]?.kind;
      return (
        quickItems.some((item) => item.id === id) ||
        kind === "healing" ||
        kind === "grenade" ||
        kind === "consumable"
      );
    },
    [inventory.details, quickItems],
  );

  const itemName = useCallback(
    (id: string) => displayItemName(view.names.items, id, inventory.details?.[id]?.baseId),
    [view.names.items, inventory.details],
  );

  const allCarried = useMemo(
    () => Object.entries(carried).filter(([, count]) => count > 0),
    [carried],
  );

  // 统一随身条目：已穿服装置顶 → 随身背包与快捷补给 → 名下车辆置底（不挤占日常随身物品）
  const allEntries = useMemo<readonly InventoryEntry[]>(() => {
    const wornEntries: InventoryEntry[] = inventory.clothing.map((entry) => ({
      entryType: "item",
      key: `worn:${entry.slot}:${entry.id}`,
      id: entry.id,
      count: 1,
      worn: true,
      slot: entry.slot,
    }));
    const bagEntries: InventoryEntry[] = allCarried.map(([id, count]) => ({
      entryType: "item",
      key: id,
      id,
      count,
      worn: false,
    }));
    const vehicleEntries: InventoryEntry[] = view.travel.vehicles.map((vehicle) => ({
      entryType: "vehicle",
      key: `vehicle:${vehicle.id}`,
      id: vehicle.id,
      vehicle,
    }));
    return [...wornEntries, ...bagEntries, ...vehicleEntries];
  }, [allCarried, inventory.clothing, view.travel.vehicles]);

  const shopModMeta = useMemo(() => {
    const map = new Map<string, ShopModMeta>();
    for (const shop of view.shops) {
      for (const s of shop.shelf) {
        if (s.kind === "mod") {
          map.set(s.id, { rarity: s.rarity, rarityLabel: s.rarityLabel, ability: s.ability });
        }
      }
      for (const w of shop.gunsmith?.weapons ?? []) {
        for (const slot of w.slots) {
          if (slot.installed) {
            map.set(slot.installed.id, {
              rarity: slot.installed.rarity,
              rarityLabel: slot.installed.rarityLabel,
              ability: slot.installed.ability,
            });
          }
          for (const opt of slot.options) {
            map.set(opt.id, {
              rarity: opt.rarity,
              rarityLabel: opt.rarityLabel,
              ability: opt.ability,
            });
          }
        }
      }
    }
    return map;
  }, [view.shops]);

  // 各类目数量统计（含已穿服装与名下车辆）
  const filterCounts = useMemo(() => {
    const counts: Record<InventoryFilter, number> = {
      all: allEntries.length,
      usable: 0,
      weapon: 0,
      clothing: 0,
      mod: 0,
      neural: 0,
      vehicle: 0,
      misc: 0,
    };
    for (const entry of allEntries) {
      if (entry.entryType === "vehicle") {
        counts.vehicle += 1;
        continue;
      }
      if (entry.worn) {
        counts.clothing += 1;
        continue;
      }
      const detail = inventory.details?.[entry.id];
      const kind = detail?.kind;
      const isNeural = Boolean(detail?.neuralGroup);
      if (isUsable(entry.id)) counts.usable += 1;
      if (kind === "weapon") counts.weapon += 1;
      if (kind === "clothing") counts.clothing += 1;
      if (kind === "mod") counts.mod += 1;
      if (isNeural) counts.neural += 1;
      if (kind === "misc" && !isNeural) counts.misc += 1;
    }
    return counts;
  }, [allEntries, inventory.details, isUsable]);

  // 过滤 + 多字段搜索 + 排序
  const visibleEntries = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const filtered = allEntries.filter((entry) => {
      if (entry.entryType === "vehicle") {
        if (filter !== "all" && filter !== "vehicle") return false;
        if (!query) return true;
        const { vehicle } = entry;
        const haystack = [
          vehicle.name,
          vehicle.maker ?? "",
          vehicle.classLabel,
          vehicle.locationName,
          vehicle.conditionLabel,
          vehicle.here ? "在身边 当前地点" : "",
          vehicle.stolen ? "赃车" : "",
          "车辆 载具 后备箱",
        ]
          .join(" ")
          .toLocaleLowerCase();
        return haystack.includes(query);
      }

      const detail = inventory.details?.[entry.id];
      const kind = entry.worn ? "clothing" : detail?.kind;
      const isNeural = !entry.worn && Boolean(detail?.neuralGroup);
      const matchesFilter =
        filter === "all" ||
        (filter === "usable"
          ? !entry.worn && isUsable(entry.id)
          : filter === "neural"
            ? isNeural
            : filter === "misc"
              ? kind === "misc" && !isNeural
              : kind === filter);
      if (!matchesFilter) return false;

      if (!query) return true;
      const chip = entry.worn ? undefined : carriedChipById.get(entry.id);
      const haystack = [
        itemName(entry.id),
        detail?.subLabel ?? (entry.slot ? inventoryRules.CLOTHING_SLOT_LABELS[entry.slot] : ""),
        detail?.rarityLabel ?? "",
        detail?.ability ?? "",
        entry.worn ? "已穿 穿着" : "",
        chip?.title ?? "",
        chip?.summary ?? "",
        chip?.categoryLabel ?? "",
      ]
        .join(" ")
        .toLocaleLowerCase();
      return haystack.includes(query);
    });

    if (sort === "default") return filtered;

    return [...filtered].sort((a, b) => {
      const aVehicle = a.entryType === "vehicle";
      const bVehicle = b.entryType === "vehicle";
      const dA = aVehicle ? undefined : inventory.details?.[a.id];
      const dB = bVehicle ? undefined : inventory.details?.[b.id];
      if (sort === "rarity") {
        const iconicDiff = Number(Boolean(dB?.iconic)) - Number(Boolean(dA?.iconic));
        if (iconicDiff !== 0) return iconicDiff;
        const rA = aVehicle ? 0 : (RARITY_RANK[dA?.rarity ?? inventory.rarity[a.id] ?? ""] ?? 0);
        const rB = bVehicle ? 0 : (RARITY_RANK[dB?.rarity ?? inventory.rarity[b.id] ?? ""] ?? 0);
        if (rB !== rA) return rB - rA;
      } else if (sort === "kind") {
        const kA =
          KIND_RANK[aVehicle ? "vehicle" : a.worn ? "clothing" : (dA?.kind ?? "misc")] ?? 9;
        const kB =
          KIND_RANK[bVehicle ? "vehicle" : b.worn ? "clothing" : (dB?.kind ?? "misc")] ?? 9;
        if (kA !== kB) return kA - kB;
      } else if (sort === "carry") {
        const cA = aVehicle || a.worn ? 0 : (dA?.carryUnits ?? 0);
        const cB = bVehicle || b.worn ? 0 : (dB?.carryUnits ?? 0);
        if (cB !== cA) return cB - cA;
      }
      if (aVehicle !== bVehicle) return aVehicle ? 1 : -1;
      if (!aVehicle && !bVehicle && a.worn !== b.worn) return a.worn ? -1 : 1;
      const nameA = aVehicle ? a.vehicle.name : itemName(a.id);
      const nameB = bVehicle ? b.vehicle.name : itemName(b.id);
      return nameA.localeCompare(nameB, "zh-Hans-CN");
    });
  }, [
    allEntries,
    carriedChipById,
    filter,
    inventory.details,
    inventory.rarity,
    isUsable,
    itemName,
    search,
    sort,
  ]);

  // 智能焦点保持：支持穿脱切换、车辆条目、武器改装物化 ID 变化追踪与耗尽/存入后就近邻项补位
  const matchedEntry = pickedItem?.id
    ? (visibleEntries.find((entry) => {
        if (pickedItem.entryType && entry.entryType !== pickedItem.entryType) return false;
        if (entry.entryType === "vehicle") return entry.id === pickedItem.id;
        return entry.id === pickedItem.id && entry.worn === Boolean(pickedItem.worn);
      }) ??
      visibleEntries.find((entry) => entry.entryType === "item" && entry.id === pickedItem.id) ??
      visibleEntries.find(
        (entry) =>
          entry.entryType === "item" &&
          !entry.worn &&
          inventory.details?.[entry.id]?.baseId ===
            (inventory.details?.[pickedItem.id]?.baseId ?? baseWeaponIdOf(pickedItem.id)),
      ))
    : undefined;
  const fallbackEntry =
    pickedItem?.fallbackIndex !== undefined && visibleEntries.length > 0
      ? visibleEntries[Math.min(pickedItem.fallbackIndex, visibleEntries.length - 1)]
      : visibleEntries[0];
  const selectedEntry = matchedEntry ?? fallbackEntry ?? null;
  const selectedIsWorn = selectedEntry?.entryType === "item" && selectedEntry.worn;
  const selectedIndex = selectedEntry
    ? visibleEntries.findIndex((entry) => entry.key === selectedEntry.key)
    : -1;

  const selectEntry = useCallback((entry: InventoryEntry, fallbackIndex?: number) => {
    setPickedItem({
      id: entry.id,
      entryType: entry.entryType,
      ...(entry.entryType === "item" ? { worn: entry.worn } : {}),
      ...(fallbackIndex !== undefined ? { fallbackIndex } : {}),
    });
    setOpenSlotPicker(null);
    setUseError("");
  }, []);

  const runDirectUse = useCallback(
    async (task: () => Promise<void>, successMessage?: string, itemId?: string) => {
      if (actionPending.current || disabledReason) return;
      actionPending.current = true;
      setUsingItem(true);
      setUseError("");
      try {
        await task();
        if (successMessage) showReceipt(successMessage, itemId);
      } catch (error) {
        setUseError(error instanceof Error ? error.message : "操作失败，请重试");
      } finally {
        actionPending.current = false;
        setUsingItem(false);
      }
    },
    [disabledReason, showReceipt],
  );

  // 选中物品的派生操作状态（提取到顶层以便键盘 Enter 和双击动作复用）
  const selectedCtx = useMemo(() => {
    if (selectedEntry?.entryType !== "item") return null;
    const { id, count, worn } = selectedEntry;
    const to = worn ? undefined : inventory.equipTo[id];
    const detail = inventory.details?.[id];
    const chip = worn ? undefined : carriedChipById.get(id);
    const quick = worn ? undefined : quickItems.find((q) => q.id === id);
    const kind = worn ? "clothing" : detail?.kind;
    const usable = !worn && (kind === "healing" || kind === "grenade" || kind === "consumable");
    const remaining = quick?.charges ?? detail?.remaining;
    const useSpare = Boolean(
      quick &&
        remaining === 0 &&
        (kind === "healing"
          ? inventory.quickSupplyAvailable.healing
          : kind === "grenade"
            ? inventory.quickSupplyAvailable.grenade
            : false),
    );
    const ceiling =
      view.health.wound === "severe" ? Math.floor(view.health.max * 0.29) : view.health.max;
    const directHeal = kind === "healing" && !view.combat.active;
    const directSuppressant = id === "psycho-suppressant" && !view.combat.active;
    const suppressantUntil = view.psychosis.suppressant.until;
    const useBlocked =
      disabledReason ||
      (usingItem
        ? "正在使用物品…"
        : view.health.condition !== "up"
          ? "当前无法自行使用物品"
          : (kind === "healing" || kind === "grenade") && remaining === 0 && !useSpare
            ? "这份补给已耗尽，需要取得另一份补给"
            : kind === "healing" && view.health.hp >= ceiling
              ? "已达到当前治疗上限"
              : directSuppressant && suppressantUntil
                ? `压制剂仍在起效中（到 ${suppressantUntil}）`
                : !quick &&
                    (kind === "grenade" || (kind === "healing" && Boolean(view.combat.active)))
                  ? "先设为当前使用的物品"
                  : undefined);
    const directUseMissing = directHeal ? !onHeal : directSuppressant ? !onSuppressant : !onUse;
    return {
      id,
      count,
      to,
      detail,
      chip,
      quick,
      kind,
      usable,
      remaining,
      useSpare,
      directHeal,
      directSuppressant,
      useBlocked,
      directUseMissing,
    };
  }, [
    carriedChipById,
    disabledReason,
    inventory.details,
    inventory.equipTo,
    inventory.quickSupplyAvailable.grenade,
    inventory.quickSupplyAvailable.healing,
    onHeal,
    onSuppressant,
    onUse,
    quickItems,
    selectedEntry,
    usingItem,
    view.combat.active,
    view.health.condition,
    view.health.hp,
    view.health.max,
    view.health.wound,
    view.psychosis.suppressant.until,
  ]);

  const triggerEquip = useCallback(
    (id: string, kind: string | undefined) => {
      if (!onEquip || usingItem || disabledReason) return;
      if (kind === "clothing") {
        setPickedItem({ id, worn: true, entryType: "item" });
        showReceipt(`已穿上「${itemName(id)}」`, id);
      } else {
        setPickedItem({ id, worn: false, entryType: "item" });
        showReceipt(
          kind === "healing"
            ? `已将「${itemName(id)}」设为当前治疗品`
            : `已将「${itemName(id)}」设为当前手雷`,
          id,
        );
      }
      onEquip(id);
    },
    [disabledReason, itemName, onEquip, showReceipt, usingItem],
  );

  const triggerUnequip = useCallback(
    (id: string) => {
      if (!onUnequip || usingItem || disabledReason) return;
      setPickedItem({ id, worn: false, entryType: "item" });
      showReceipt(`已脱下「${itemName(id)}」并放回随身背包`, id);
      onUnequip(id);
    },
    [disabledReason, itemName, onUnequip, showReceipt, usingItem],
  );

  const triggerMod = useCallback(
    (action: "attach" | "detach", weaponId: string, modId: string) => {
      if (!onMod || usingItem || disabledReason) return;
      onMod(action, weaponId, modId);
      showReceipt(
        action === "attach"
          ? `已将「${itemName(modId)}」装到「${itemName(weaponId)}」`
          : `已从「${itemName(weaponId)}」拆下「${itemName(modId)}」`,
        weaponId,
      );
    },
    [disabledReason, itemName, onMod, showReceipt, usingItem],
  );

  // 安全快操：双击列表项或按 Enter 时执行“打开后备箱 / 穿上 / 脱下 / 设为当前补给 / 非战斗治疗或压制剂 / 切至可装槽位”
  const triggerSafePrimary = useCallback(
    (entry: InventoryEntry) => {
      if (entry.entryType === "vehicle") {
        if (storageByKey.has(entry.key) && onOpenStorage) {
          onOpenStorage(entry.key);
        }
        return;
      }
      if (disabledReason || usingItem) return;
      if (entry.worn) {
        if (onUnequip) triggerUnequip(entry.id);
        return;
      }
      const { id } = entry;
      const detail = inventory.details?.[id];
      const to = inventory.equipTo[id];
      const quick = quickItems.find((q) => q.id === id);
      if (to === "clothing" && onEquip) {
        triggerEquip(id, detail?.kind);
        return;
      }
      if (to === "quick" && !quick && onEquip && !view.combat.active) {
        triggerEquip(id, detail?.kind);
        return;
      }
      if (detail?.kind === "weapon") {
        const firstEmpty = detail.modSlots.find((slot) => {
          const installed = detail.weaponState?.mods[slot];
          if (installed) return false;
          const slotLabel = inventoryRules.MOD_SLOT_LABELS[slot];
          return allCarried.some(([modId]) => {
            const md = inventory.details?.[modId];
            return (
              md?.kind === "mod" &&
              md.subLabel === `改装 · ${slotLabel}` &&
              (inventory.modTargets[modId] ?? []).includes(id)
            );
          });
        });
        if (firstEmpty) {
          setOpenSlotPicker({ weaponId: id, slot: firstEmpty });
        }
        return;
      }
      if (selectedCtx && selectedCtx.id === id && !selectedCtx.useBlocked) {
        if (selectedCtx.directHeal && onHeal) {
          void runDirectUse(() => onHeal(id), `已使用「${itemName(id)}」`, id);
        } else if (selectedCtx.directSuppressant && onSuppressant) {
          void runDirectUse(onSuppressant, "已注射赛博精神病压制剂", id);
        }
      }
    },
    [
      allCarried,
      disabledReason,
      inventory.details,
      inventory.equipTo,
      inventory.modTargets,
      itemName,
      onEquip,
      onHeal,
      onOpenStorage,
      onSuppressant,
      onUnequip,
      quickItems,
      runDirectUse,
      selectedCtx,
      storageByKey,
      triggerEquip,
      triggerUnequip,
      usingItem,
      view.combat.active,
    ],
  );

  // 分层 Esc 接入全局面板栈：先关改装抽屉 → 退搜索框 → 清搜索 → 最后交回外层关面板
  useLayer(
    () => {
      if (openSlotPicker) {
        setOpenSlotPicker(null);
      } else if (searchFocused) {
        if (search) setSearch("");
        searchRef.current?.blur();
      } else {
        setSearch("");
      }
    },
    Boolean(openSlotPicker || searchFocused || search),
  );

  // 键盘流：↑/↓ 切换列表项，/ 聚焦搜索，Enter 执行安全主操作
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;

      if (event.key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (visibleEntries.length === 0) return;
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        const cur = selectedIndex < 0 ? (delta > 0 ? -1 : 0) : selectedIndex;
        const nextIdx = (cur + delta + visibleEntries.length) % visibleEntries.length;
        const nextEntry = visibleEntries[nextIdx];
        if (nextEntry) {
          selectEntry(nextEntry, nextIdx);
          const row = listRef.current?.querySelector<HTMLElement>(`[data-item-index="${nextIdx}"]`);
          row?.scrollIntoView({ block: "nearest" });
        }
        return;
      }

      if (event.key === "Enter" && !event.repeat) {
        const activeEl = document.activeElement;
        if (
          activeEl instanceof HTMLElement &&
          activeEl.closest("button") &&
          !activeEl.hasAttribute("data-item-index")
        ) {
          return;
        }
        if (selectedEntry) {
          event.preventDefault();
          triggerSafePrimary(selectedEntry);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [selectEntry, selectedEntry, selectedIndex, triggerSafePrimary, visibleEntries]);

  const places = view.safehouse.forSale.length > 0;
  const storage = view.safehouse.storage;
  const storeTargets = storage.filter((group) => group.canStore);
  const storeTarget = storeTargets.find((group) => group.key === storageKey) ?? storeTargets[0];
  const storeBlocked =
    disabledReason ||
    (usingItem
      ? "正在处理物品，请稍候"
      : view.combat.active
        ? "交战中存取物品需要在行动里描述"
        : view.health.condition !== "up"
          ? "当前无法自行存取物品"
          : !storeTarget
            ? "到达自有住处或车辆所在地点后可存放"
            : !onPlaceItem
              ? "当前无法存放物品"
              : undefined);

  const filterTabs: readonly (readonly [InventoryFilter, string, number])[] = [
    ["all", "全部", filterCounts.all],
    ["usable", "可用", filterCounts.usable],
    ["weapon", "武器", filterCounts.weapon],
    ["clothing", "服装", filterCounts.clothing],
    ["mod", "改装件", filterCounts.mod],
    ["neural", "芯片/超梦", filterCounts.neural],
    ["vehicle", "车辆", filterCounts.vehicle],
    ["misc", "杂物", filterCounts.misc],
  ];

  const cycleSort = () => {
    const idx = SORT_CYCLE.indexOf(sort);
    const next = SORT_CYCLE[(idx + 1) % SORT_CYCLE.length] ?? "default";
    setSort(next);
  };

  return (
    <div className={styles.inventoryRoot}>
      {(disabledReason || view.combat.active || useError || receipt) && (
        <div className={styles.bannerStack}>
          {disabledReason && (
            <p role="status" className={styles.noticeBanner}>
              <span>{disabledReason}</span>
            </p>
          )}
          {!disabledReason && view.combat.active && (
            <p role="status" className={styles.combatBanner}>
              <span>交战锁定：换装、拆装改装件与存取物品需在行动中描述，使用快捷栏补给照常。</span>
            </p>
          )}
          {useError && (
            <p role="alert" className={styles.errorBanner}>
              <span>{useError}</span>
            </p>
          )}
          {receipt && (
            <p role="status" className={styles.receiptBanner}>
              <span>{receipt}</span>
            </p>
          )}
        </div>
      )}

      {/* 背包主区：筛选 + 排序 + 搜索 + 全高双栏独立滚动 */}
      <section className={styles.packSection} aria-label="随身行装与背包">
        <div className={styles.toolbar}>
          <nav className={styles.filterRow} aria-label="物品分类筛选">
            {filterTabs.map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                className={styles.filterChip}
                aria-pressed={filter === key}
                data-zero={count === 0 && key !== "all" ? "" : undefined}
                onClick={() => {
                  setFilter(key);
                  setPickedItem(null);
                  setUseError("");
                }}
              >
                <span>{label}</span>
                {count > 0 && <b className={styles.filterChipCount}>{count}</b>}
              </button>
            ))}
          </nav>

          <div className={styles.toolbarRight}>
            <button
              type="button"
              className={styles.sortBtn}
              title="点击切换排序方式：默认 / 品质 / 类型 / 负担"
              onClick={cycleSort}
            >
              <span>排序</span>
              <b>{SORT_LABELS[sort]}</b>
            </button>
            <FrameBox className={styles.searchBox}>
              <input
                ref={searchRef}
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                placeholder="搜名称、类型、能力…"
                aria-label="搜索物品（按 / 聚焦）"
                className={styles.searchInput}
              />
              {search ? (
                <button
                  type="button"
                  className={styles.searchClear}
                  aria-label="清空搜索"
                  onClick={() => setSearch("")}
                >
                  ×
                </button>
              ) : (
                <kbd className={styles.searchKey} aria-hidden>
                  /
                </kbd>
              )}
            </FrameBox>
          </div>
        </div>

        {visibleEntries.length === 0 ? (
          <div className={styles.emptyBox}>
            <CellFrame />
            <span>
              {allEntries.length === 0
                ? "随身物品栏是空的。"
                : search || filter !== "all"
                  ? "没有符合当前筛选条件的物品。"
                  : "随身物品栏是空的。"}
            </span>
            {(search || filter !== "all") && (
              <ActionButton
                onClick={() => {
                  setFilter("all");
                  setSearch("");
                }}
              >
                重置全部筛选
              </ActionButton>
            )}
          </div>
        ) : (
          <div className={styles.browser}>
            <ul ref={listRef} className={styles.itemList} aria-label="选择随身物品">
              {visibleEntries.map((entry, index) => {
                const isSelected = selectedEntry?.key === entry.key;

                if (entry.entryType === "vehicle") {
                  const { vehicle } = entry;
                  const art = vehicleArtOf(vehicle.model);
                  const trunk = storageByKey.get(entry.key);
                  const trunkCount = trunk
                    ? trunk.items.reduce((sum, row) => sum + row.count, 0)
                    : 0;
                  const locationSummary =
                    vehicle.location === null
                      ? "位置未知"
                      : vehicle.here
                        ? `停在当前地点 · ${vehicle.locationName}`
                        : `停在 ${vehicle.locationName}`;

                  return (
                    <li key={entry.key}>
                      <button
                        type="button"
                        data-item-index={index}
                        className={styles.itemRow}
                        aria-pressed={isSelected}
                        data-vehicle-here={vehicle.here || undefined}
                        onClick={() => selectEntry(entry, index)}
                        onDoubleClick={() => {
                          selectEntry(entry, index);
                          triggerSafePrimary(entry);
                        }}
                      >
                        <NineSlice
                          id="map.filterCellBg"
                          tint="var(--item-fill, rgb(13 15 24 / 82%))"
                          slice={CELL_SLICE}
                        />
                        <NineSlice
                          id="map.filterCellFg"
                          tint="var(--item-line)"
                          slice={CELL_SLICE}
                        />

                        <span className={styles.itemThumb} aria-hidden>
                          <span
                            className={styles.itemThumbGrid}
                            style={{ backgroundImage: cssUrl("fx.grid") }}
                          />
                          {art ? (
                            <Asset id={art} className={styles.itemArt} />
                          ) : (
                            <Asset id="notify.inventory" tint="var(--cp-cyan)" height={18} />
                          )}
                        </span>

                        <span className={styles.itemInfo}>
                          <span className={styles.itemTopLine}>
                            <strong className={styles.itemName}>{vehicle.name}</strong>
                            {vehicle.here && (
                              <span className={styles.miniTag} data-tone="green">
                                在身边
                              </span>
                            )}
                            {vehicle.condition === "wrecked" && (
                              <span className={styles.miniTag} data-tone="danger">
                                报废
                              </span>
                            )}
                            {vehicle.condition === "damaged" && (
                              <span className={styles.miniTag} data-tone="yellow">
                                受损
                              </span>
                            )}
                            {vehicle.stolen && (
                              <span className={styles.miniTag} data-tone="yellow">
                                赃车
                              </span>
                            )}
                          </span>

                          <span className={styles.itemSubLine}>
                            <span className={styles.itemSubText}>
                              {vehicle.classLabel ? `${vehicle.classLabel} · ` : ""}
                              {locationSummary}
                            </span>
                          </span>
                        </span>

                        <span className={styles.itemMeta}>
                          {trunk && (
                            <span className={styles.itemCarryTag}>
                              {trunkCount > 0 ? `后备箱 ${trunkCount}` : "后备箱空"}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                }

                const { id, count, worn } = entry;
                const quick = worn ? undefined : quickItems.find((item) => item.id === id);
                const detail = inventory.details?.[id];
                const chip = worn ? undefined : carriedChipById.get(id);
                const art = itemArtOf(detail?.baseId ?? id);
                const rarity = detail?.rarity ?? inventory.rarity[id];
                const isHeld =
                  !worn &&
                  detail?.kind === "weapon" &&
                  Boolean(inventory.heldWeapons?.includes(id));
                const isSilenced =
                  !worn &&
                  detail?.kind === "weapon" &&
                  detail.noise === "silent" &&
                  !detail.subLabel.includes("刀剑") &&
                  !detail.subLabel.includes("钝器");
                const modSlots = !worn && detail?.kind === "weapon" ? detail.modSlots : [];
                const carryUnits = worn ? 0 : (detail?.carryUnits ?? 0);
                const subLabel =
                  detail?.subLabel ??
                  (entry.slot ? inventoryRules.CLOTHING_SLOT_LABELS[entry.slot] : "物品");
                const chipStatusTags = chip
                  ? [
                      chip.categoryLabel,
                      chip.encrypted ? chip.encryptionLabel : null,
                      chip.inspected && chip.hazard && chip.hazard !== "none"
                        ? chip.hazardLabel
                        : !chip.inspected && chip.category === "daemon"
                          ? "未查毒"
                          : null,
                      chip.eddiesRemaining > 0 ? `含 ${chip.eddiesRemaining} €$` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : null;

                return (
                  <li key={entry.key}>
                    <button
                      type="button"
                      data-item-index={index}
                      className={styles.itemRow}
                      aria-pressed={isSelected}
                      data-worn={worn || undefined}
                      data-rarity={rarity ?? undefined}
                      data-iconic={detail?.iconic || undefined}
                      data-flash={flashId === id || undefined}
                      onClick={() => selectEntry(entry, index)}
                      onDoubleClick={() => {
                        selectEntry(entry, index);
                        triggerSafePrimary(entry);
                      }}
                    >
                      <NineSlice
                        id="map.filterCellBg"
                        tint="var(--item-fill, rgb(13 15 24 / 82%))"
                        slice={CELL_SLICE}
                      />
                      <NineSlice id="map.filterCellFg" tint="var(--item-line)" slice={CELL_SLICE} />
                      {rarity && (
                        <NineSlice
                          id="cyber.cellRarity"
                          tint="var(--rarity)"
                          slice={0}
                          className={styles.itemRarityBar}
                        />
                      )}

                      <span className={styles.itemThumb} aria-hidden>
                        <span
                          className={styles.itemThumbGrid}
                          style={{ backgroundImage: cssUrl("fx.grid") }}
                        />
                        {art ? (
                          <Asset id={art} className={styles.itemArt} />
                        ) : (
                          <Asset id="notify.inventory" tint="var(--cp-cyan)" height={18} />
                        )}
                      </span>

                      <span className={styles.itemInfo}>
                        <span className={styles.itemTopLine}>
                          <strong className={styles.itemName}>{itemName(id)}</strong>
                          {worn && (
                            <span className={styles.miniTag} data-tone="yellow">
                              已穿
                            </span>
                          )}
                          {isHeld && (
                            <span className={styles.miniTag} data-tone="yellow">
                              持用
                            </span>
                          )}
                          {isSilenced && <span className={styles.miniTag}>消音</span>}
                          {detail?.grantsSmartLink && (
                            <span className={styles.miniTag} data-tone="yellow">
                              智能
                            </span>
                          )}
                          {chip?.slotted && (
                            <span className={styles.miniTag} data-tone="green">
                              插槽
                            </span>
                          )}
                        </span>

                        <span className={styles.itemSubLine}>
                          <span className={styles.itemSubText}>
                            {chipStatusTags ?? (
                              <>
                                {subLabel}
                                {detail?.rarityLabel && (
                                  <>
                                    {" · "}
                                    <span className={styles.itemRarityWord}>
                                      {detail.rarityLabel}
                                    </span>
                                  </>
                                )}
                              </>
                            )}
                          </span>
                          {modSlots.length > 0 && (
                            <span
                              className={styles.modPips}
                              title={`${modSlots.length} 个改装槽位`}
                              aria-hidden="true"
                            >
                              {modSlots.map((slot) => {
                                const locked =
                                  detail?.weaponState?.lockedSlots.includes(slot) ?? false;
                                const filled = Boolean(detail?.weaponState?.mods[slot]);
                                return (
                                  <i
                                    key={slot}
                                    className={styles.modPip}
                                    data-state={locked ? "locked" : filled ? "filled" : "empty"}
                                  />
                                );
                              })}
                            </span>
                          )}
                        </span>
                      </span>

                      <span className={styles.itemMeta}>
                        {quick ? (
                          <UnreadBadge>{`${quick.charges}/${quick.max}`}</UnreadBadge>
                        ) : count > 1 ? (
                          <b className={styles.itemCount}>×{count}</b>
                        ) : null}
                        {carryUnits > 0 && (
                          <span
                            className={styles.itemCarryTag}
                            data-bulky={detail?.bulky || undefined}
                            title={`单件携带负担 ${carryUnits} 分`}
                          >
                            负担 {carryUnits}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            {selectedEntry?.entryType === "vehicle" &&
              (() => {
                const { vehicle } = selectedEntry;
                const art = vehicleArtOf(vehicle.model);
                const trunk = storageByKey.get(selectedEntry.key);
                const trunkCount = trunk ? trunk.items.reduce((sum, row) => sum + row.count, 0) : 0;
                const trunkReachable = Boolean(trunk && (trunk.canTake || trunk.canStore));
                const locationText =
                  vehicle.location === null
                    ? "位置未知"
                    : vehicle.here
                      ? `停在当前地点 · ${vehicle.locationName}`
                      : `停在 ${vehicle.locationName}`;

                return (
                  <article
                    key={selectedEntry.key}
                    className={styles.detailCard}
                    aria-label="选中车辆详情"
                  >
                    <CellFrame />
                    <span
                      className={styles.detailGrid}
                      style={{ backgroundImage: cssUrl("fx.grid") }}
                      aria-hidden
                    />

                    <header className={styles.detailHead}>
                      <div className={styles.detailTitleRow}>
                        <strong className={styles.detailTitle}>{vehicle.name}</strong>
                        {vehicle.maker && (
                          <span className={styles.itemCarryTag}>{vehicle.maker}</span>
                        )}
                      </div>
                      <div className={styles.detailTags}>
                        <span className={styles.pill}>
                          <NineSlice id="cyber.gaugeLabel" tint="rgb(94 246 255 / 16%)" slice={4} />
                          <span className={styles.pillText}>{vehicle.classLabel || "载具"}</span>
                        </span>
                        {vehicle.here && (
                          <span className={styles.pillActive}>
                            <NineSlice id="cyber.gaugeLabel" tint="var(--cp-yellow)" slice={4} />
                            <span className={styles.pillText}>在身边</span>
                          </span>
                        )}
                        <span className={styles.pill}>
                          <NineSlice
                            id="cyber.gaugeLabel"
                            tint={
                              vehicle.condition === "wrecked"
                                ? "rgb(255 68 68 / 28%)"
                                : vehicle.condition === "damaged"
                                  ? "rgb(252 238 10 / 22%)"
                                  : "rgb(74 222 128 / 18%)"
                            }
                            slice={4}
                          />
                          <span className={styles.pillText}>车况：{vehicle.conditionLabel}</span>
                        </span>
                        {vehicle.stolen && (
                          <span className={styles.pill}>
                            <NineSlice
                              id="cyber.gaugeLabel"
                              tint="rgb(252 238 10 / 22%)"
                              slice={4}
                            />
                            <span className={styles.pillText}>赃车</span>
                          </span>
                        )}
                        {vehicle.seats > 0 && (
                          <span className={styles.pill}>
                            <NineSlice
                              id="cyber.gaugeLabel"
                              tint="rgb(148 163 184 / 16%)"
                              slice={4}
                            />
                            <span className={styles.pillText}>{vehicle.seats} 座</span>
                          </span>
                        )}
                      </div>
                    </header>

                    <div className={styles.detailScroll}>
                      {art && (
                        <div className={styles.showcase} aria-hidden>
                          <CellFrame />
                          <span
                            className={styles.showcaseGrid}
                            style={{ backgroundImage: cssUrl("fx.grid") }}
                          />
                          {vehicle.classLabel && (
                            <span className={styles.showcaseCornerLeft}>{vehicle.classLabel}</span>
                          )}
                          {vehicle.speed > 0 && (
                            <span className={styles.showcaseCornerRight}>极速 {vehicle.speed}</span>
                          )}
                          <Asset id={art} className={styles.showcaseArt} />
                        </div>
                      )}

                      <div className={styles.detailCopy}>
                        <p className={styles.detailDesc}>{locationText}</p>
                        <p className={styles.detailStat}>
                          {trunk
                            ? trunkCount > 0
                              ? `后备箱内存放 ${trunkCount} 件物品${trunkReachable ? "（当前就在现场，可直接存取）" : "（远端只读）"}`
                              : `后备箱为空${trunkReachable ? "（当前就在现场，可将随身物品存入）" : ""}`
                            : "该车辆暂无可用储物空间"}
                        </p>
                        {trunk?.blockedReason && (
                          <p className={styles.actionHint}>{trunk.blockedReason}</p>
                        )}
                      </div>
                    </div>

                    <footer className={styles.detailFooter}>
                      {trunk && onOpenStorage ? (
                        <div className={styles.actionRow}>
                          <Button
                            small
                            primary={trunkReachable}
                            onClick={() => onOpenStorage(selectedEntry.key)}
                          >
                            {trunkReachable
                              ? trunkCount > 0
                                ? `管理后备箱（${trunkCount} 件）→`
                                : "打开后备箱 →"
                              : `查看后备箱（${trunkCount} 件）→`}
                          </Button>
                        </div>
                      ) : null}
                      <p className={styles.actionHint}>
                        {trunkReachable
                          ? "双击车辆条目或按 Enter 可直接进入后备箱存取物品。"
                          : "开往或返回车辆停放地点后即可在现场存取后备箱物品。"}
                      </p>
                    </footer>
                  </article>
                );
              })()}

            {selectedCtx &&
              (() => {
                const {
                  id,
                  count,
                  to,
                  detail,
                  chip,
                  quick,
                  kind,
                  usable,
                  remaining,
                  useSpare,
                  directHeal,
                  directSuppressant,
                  useBlocked,
                  directUseMissing,
                } = selectedCtx;
                const art = itemArtOf(detail?.baseId ?? id);
                const rarity = detail?.rarity ?? inventory.rarity[id];
                const itemStoreBlocked = chip?.slotted
                  ? "请先从个人神经芯片槽拔下后再存放"
                  : storeBlocked;
                const modSlot =
                  kind === "mod"
                    ? inventoryRules.ModSlotSchema.options.find(
                        (s) => detail?.subLabel === `改装 · ${inventoryRules.MOD_SLOT_LABELS[s]}`,
                      )
                    : undefined;
                const modTargets = selectedIsWorn ? [] : (inventory.modTargets[id] ?? []);
                const carryUnits = detail?.carryUnits ?? 0;

                return (
                  <article
                    key={id}
                    className={styles.detailCard}
                    data-rarity={rarity ?? undefined}
                    data-iconic={detail?.iconic || undefined}
                    aria-label="选中物品详情"
                  >
                    <CellFrame />
                    <span
                      className={styles.detailGrid}
                      style={{ backgroundImage: cssUrl("fx.grid") }}
                      aria-hidden
                    />
                    {rarity && (
                      <NineSlice
                        id="cyber.cellRarity"
                        tint="var(--rarity)"
                        slice={0}
                        className={styles.detailRarityBar}
                      />
                    )}

                    {/* 固定头部 */}
                    <header className={styles.detailHead}>
                      <div className={styles.detailTitleRow}>
                        <strong className={styles.detailTitle}>{itemName(id)}</strong>
                        {count > 1 && <b className={styles.detailCount}>×{count}</b>}
                      </div>
                      <div className={styles.detailTags}>
                        {detail?.rarityLabel && (
                          <span className={styles.pillRarity}>
                            <NineSlice
                              id="cyber.gaugeLabel"
                              tint="var(--rarity, var(--cp-cyan))"
                              slice={4}
                            />
                            <span className={styles.pillText}>{detail.rarityLabel}</span>
                          </span>
                        )}
                        {detail?.subLabel && (
                          <span className={styles.pill}>
                            <NineSlice
                              id="cyber.gaugeLabel"
                              tint="rgb(94 246 255 / 16%)"
                              slice={4}
                            />
                            <span className={styles.pillText}>{detail.subLabel}</span>
                          </span>
                        )}
                        {carryUnits > 0 && (
                          <span className={styles.pill}>
                            <NineSlice
                              id="cyber.gaugeLabel"
                              tint={
                                detail?.bulky ? "rgb(252 238 10 / 22%)" : "rgb(148 163 184 / 16%)"
                              }
                              slice={4}
                            />
                            <span className={styles.pillText}>
                              {detail?.bulky ? `大件 · 负担 ${carryUnits}` : `负担 ${carryUnits}`}
                            </span>
                          </span>
                        )}
                        {kind === "weapon" && detail?.concealment && (
                          <span className={styles.pill}>
                            <NineSlice
                              id="cyber.gaugeLabel"
                              tint="rgb(94 246 255 / 12%)"
                              slice={4}
                            />
                            <span className={styles.pillText}>
                              {CONCEALMENT_LABELS[detail.concealment]}
                            </span>
                          </span>
                        )}
                        {kind === "weapon" &&
                          detail?.noise === "silent" &&
                          !detail.subLabel.includes("刀剑") &&
                          !detail.subLabel.includes("钝器") && (
                            <span className={styles.pill}>
                              <NineSlice
                                id="cyber.gaugeLabel"
                                tint="rgb(94 246 255 / 22%)"
                                slice={4}
                              />
                              <span className={styles.pillText}>{NOISE_LABELS[detail.noise]}</span>
                            </span>
                          )}
                        {kind === "weapon" && detail?.grantsSmartLink && (
                          <span className={styles.pill}>
                            <NineSlice
                              id="cyber.gaugeLabel"
                              tint="rgb(252 238 10 / 20%)"
                              slice={4}
                            />
                            <span className={styles.pillText}>智能联锁</span>
                          </span>
                        )}
                        {selectedIsWorn && (
                          <span className={styles.pillActive}>
                            <NineSlice id="cyber.gaugeLabel" tint="var(--cp-yellow)" slice={4} />
                            <span className={styles.pillText}>当前穿着</span>
                          </span>
                        )}
                        {kind === "weapon" && inventory.heldWeapons?.includes(id) && (
                          <span className={styles.pillActive}>
                            <NineSlice id="cyber.gaugeLabel" tint="var(--cp-yellow)" slice={4} />
                            <span className={styles.pillText}>当前持用</span>
                          </span>
                        )}
                        {quick ? (
                          <span className={styles.pillActive}>
                            <NineSlice id="cyber.gaugeLabel" tint="var(--cp-yellow)" slice={4} />
                            <span className={styles.pillText}>
                              快捷栏 · {quick.charges}/{quick.max} 次
                            </span>
                          </span>
                        ) : remaining !== null && remaining !== undefined && detail?.charges ? (
                          <span className={styles.pill}>
                            <NineSlice
                              id="cyber.gaugeLabel"
                              tint="rgb(94 246 255 / 16%)"
                              slice={4}
                            />
                            <span className={styles.pillText}>
                              剩余 {remaining}/{detail.charges} 次
                            </span>
                          </span>
                        ) : null}
                      </div>
                    </header>

                    {/* 中间独立滚动区 */}
                    <div className={styles.detailScroll}>
                      {art && (
                        <div className={styles.showcase} aria-hidden>
                          <CellFrame />
                          <span
                            className={styles.showcaseGrid}
                            style={{ backgroundImage: cssUrl("fx.grid") }}
                          />
                          {detail?.rarityLabel && (
                            <span className={styles.showcaseCornerLeft}>{detail.rarityLabel}</span>
                          )}
                          {carryUnits > 0 && (
                            <span className={styles.showcaseCornerRight}>负担 {carryUnits}</span>
                          )}
                          <Asset id={art} className={styles.showcaseArt} />
                        </div>
                      )}

                      {(detail?.ability || chip || (kind === "healing" && detail?.healPercent)) && (
                        <div className={styles.detailCopy}>
                          {chip ? (
                            <>
                              <div className={mediaStyles.badgeRow}>
                                {chip.slotted && (
                                  <span
                                    className={`${mediaStyles.badge} ${mediaStyles.badgeActive}`}
                                  >
                                    已插入神经槽
                                  </span>
                                )}
                                {chip.encrypted && (
                                  <span className={`${mediaStyles.badge} ${mediaStyles.badgeWarn}`}>
                                    加密：{chip.encryptionLabel}
                                    {chip.lockedParts > 0 ? `（${chip.lockedParts} 段未破译）` : ""}
                                  </span>
                                )}
                                {!chip.inspected && (
                                  <span className={`${mediaStyles.badge} ${mediaStyles.badgeWarn}`}>
                                    尚未查毒
                                  </span>
                                )}
                                {chip.inspected && chip.hazard && (
                                  <span
                                    className={`${mediaStyles.badge} ${
                                      chip.hazard === "none"
                                        ? mediaStyles.badgeActive
                                        : mediaStyles.badgeDanger
                                    }`}
                                  >
                                    查毒：{chip.hazardLabel}
                                  </span>
                                )}
                                {chip.eddiesRemaining > 0 && (
                                  <span className={`${mediaStyles.badge} ${mediaStyles.badgeWarn}`}>
                                    未提取：{chip.eddiesRemaining} 欧元
                                  </span>
                                )}
                                {chip.totalParts > 0 && (
                                  <span className={mediaStyles.badge}>
                                    已读 {chip.readParts}/{chip.totalParts} 段
                                  </span>
                                )}
                              </div>
                              <p className={styles.detailDesc}>{chip.summary}</p>
                              {chip.ability && (
                                <p className={styles.detailStat}>插槽能力：{chip.ability}</p>
                              )}
                              {chip.protocol && (
                                <p className={styles.detailStat}>行为协议：{chip.protocol}</p>
                              )}
                            </>
                          ) : (
                            detail?.ability && <p className={styles.detailDesc}>{detail.ability}</p>
                          )}

                          {kind === "healing" && detail?.healPercent && (
                            <p className={styles.detailStat}>
                              便携医疗急救 · 当前伤势：
                              {woundTelemetry(view.health, view.combat, view.cyberware).title}
                            </p>
                          )}
                        </div>
                      )}

                      {kind === "weapon" && detail && (
                        <WeaponSlotInspector
                          weaponId={id}
                          detail={detail}
                          installedList={inventory.mods[id]}
                          allCarried={allCarried}
                          details={inventory.details}
                          modTargets={inventory.modTargets}
                          shopModMeta={shopModMeta}
                          itemName={itemName}
                          onMod={usingItem ? undefined : triggerMod}
                          openSlot={openSlotPicker?.weaponId === id ? openSlotPicker.slot : null}
                          onToggleSlot={(slot) =>
                            setOpenSlotPicker(slot ? { weaponId: id, slot } : null)
                          }
                        />
                      )}

                      {/* 改装件反向装配：富武器目标卡 */}
                      {kind === "mod" && modTargets.length > 0 && (
                        <section className={styles.modTargetsSection} aria-label="可装配的目标武器">
                          <span className={styles.modTargetsHead}>
                            可装配武器（{modTargets.length}）
                          </span>
                          <ul className={styles.modTargetsGrid}>
                            {modTargets.map((w) => {
                              const wDetail = inventory.details?.[w];
                              const wArt = itemArtOf(wDetail?.baseId ?? w);
                              const existingId = modSlot
                                ? wDetail?.weaponState?.mods[modSlot]
                                : undefined;
                              const alreadyFitted = existingId === id;
                              return (
                                <li key={w} className={styles.modTargetCard}>
                                  <span className={styles.modTargetThumb} aria-hidden>
                                    {wArt ? (
                                      <Asset id={wArt} className={styles.modTargetArt} />
                                    ) : (
                                      <Asset
                                        id="notify.inventory"
                                        tint="var(--cp-cyan)"
                                        height={16}
                                      />
                                    )}
                                  </span>
                                  <span className={styles.modTargetCopy}>
                                    <b>{itemName(w)}</b>
                                    <small>
                                      {alreadyFitted
                                        ? "已装配此配件"
                                        : existingId
                                          ? `当前已装：${itemName(existingId)}（装上将替换）`
                                          : `${wDetail?.subLabel ?? "武器"} · 槽位空余`}
                                    </small>
                                  </span>
                                  {onMod && (
                                    <ActionButton
                                      disabled={alreadyFitted || usingItem}
                                      onClick={() => triggerMod("attach", w, id)}
                                    >
                                      {alreadyFitted ? "已装" : existingId ? "替换" : "装上"}
                                    </ActionButton>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        </section>
                      )}
                    </div>

                    {/* 底部固定操作栏 */}
                    <footer className={styles.detailFooter}>
                      {/* 芯片 / 超梦专属动作 */}
                      {chip && onActionDraft && (
                        <div className={styles.actionRow}>
                          {(chip.category === "skill" || chip.category === "behavior") && (
                            <Button
                              small
                              primary={!chip.slotted}
                              disabled={Boolean(disabledReason)}
                              onClick={() =>
                                onActionDraft(
                                  chip.slotted
                                    ? `从颈后个人神经槽拔出${itemName(id)}`
                                    : `把${itemName(id)}插入颈后个人神经槽`,
                                )
                              }
                            >
                              {chip.slotted ? "拔出神经槽" : "插入神经槽"}
                            </Button>
                          )}
                          {chip.category === "braindance" && (
                            <Button
                              small
                              primary
                              disabled={Boolean(disabledReason)}
                              onClick={() => onActionDraft(`用超梦头环播放${itemName(id)}`)}
                            >
                              播放超梦
                            </Button>
                          )}
                          {chip.category !== "braindance" &&
                            chip.totalParts > 0 &&
                            chip.readParts < chip.totalParts && (
                              <Button
                                small
                                primary={chip.category === "intel"}
                                disabled={Boolean(disabledReason)}
                                onClick={() => onActionDraft(`读取芯片「${itemName(id)}」里的内容`)}
                              >
                                读取内容
                              </Button>
                            )}
                          {!chip.inspected && (chip.encrypted || chip.category === "daemon") && (
                            <Button
                              small
                              disabled={Boolean(disabledReason)}
                              onClick={() =>
                                onActionDraft(
                                  view.shards.hasReader
                                    ? `用隔离芯片读写器对${itemName(id)}进行沙盒查毒`
                                    : `检查${itemName(id)}是否带加密或恶意陷阱`,
                                )
                              }
                            >
                              {view.shards.hasReader ? "隔离查毒" : "检查风险"}
                            </Button>
                          )}
                          {(chip.encrypted || chip.eddiesRemaining > 0) && (
                            <Button
                              small
                              disabled={Boolean(disabledReason)}
                              onClick={() =>
                                onActionDraft(
                                  chip.eddiesRemaining > 0
                                    ? `离线破译${itemName(id)}并提取里面的 ${chip.eddiesRemaining} 欧元`
                                    : `离线破译${itemName(id)}的加密层`,
                                )
                              }
                            >
                              {chip.eddiesRemaining > 0 ? "破译并提款" : "破译加密"}
                            </Button>
                          )}
                        </div>
                      )}

                      {/* 主操作行：使用 / 穿戴 / 脱下 / 设为快捷栏 */}
                      {(usable ||
                        (to === "quick" && !quick) ||
                        (selectedIsWorn && onUnequip) ||
                        (to === "clothing" && onEquip)) && (
                        <>
                          <div className={styles.actionRow}>
                            {usable && (
                              <Button
                                small
                                primary={!useBlocked}
                                disabled={Boolean(useBlocked) || directUseMissing}
                                onClick={() => {
                                  if (useBlocked) return;
                                  if (directHeal && onHeal) {
                                    void runDirectUse(
                                      () => onHeal(id),
                                      `已使用「${itemName(id)}」`,
                                      id,
                                    );
                                  } else if (directSuppressant && onSuppressant) {
                                    void runDirectUse(onSuppressant, "已注射赛博精神病压制剂", id);
                                  } else {
                                    onUse?.(id);
                                  }
                                }}
                              >
                                {directHeal
                                  ? "使用治疗品"
                                  : directSuppressant
                                    ? "注射压制剂"
                                    : kind === "grenade"
                                      ? "准备投掷"
                                      : "准备使用"}
                              </Button>
                            )}

                            {to === "quick" && !quick && (
                              <Button
                                small
                                primary={Boolean(useBlocked)}
                                disabled={
                                  !onEquip ||
                                  Boolean(disabledReason) ||
                                  usingItem ||
                                  Boolean(view.combat.active)
                                }
                                onClick={() => triggerEquip(id, kind)}
                              >
                                {kind === "healing" ? "设为当前治疗品" : "设为当前手雷"}
                              </Button>
                            )}

                            {selectedIsWorn && onUnequip && (
                              <Button
                                small
                                disabled={usingItem || Boolean(disabledReason)}
                                onClick={() => triggerUnequip(id)}
                              >
                                脱下
                              </Button>
                            )}

                            {to === "clothing" && onEquip && (
                              <Button
                                small
                                primary
                                disabled={usingItem || Boolean(disabledReason)}
                                onClick={() => triggerEquip(id, kind)}
                              >
                                穿上
                              </Button>
                            )}
                          </div>

                          {usable &&
                            (useBlocked ? (
                              <p className={styles.actionHint}>{useBlocked}</p>
                            ) : useSpare ? (
                              <p className={styles.actionHint}>将取用随身携带的同款备用补给。</p>
                            ) : !directHeal && !directSuppressant ? (
                              <p className={styles.actionHint}>填入行动输入框，由你确认后执行。</p>
                            ) : null)}
                        </>
                      )}

                      {/* 存放区块：可达时展示存放按钮与目标切换芯片；不可达时降级为低饱和状态条 */}
                      {!itemStoreBlocked && storeTarget && onPlaceItem ? (
                        <div className={styles.storeBar}>
                          {storeTargets.length > 1 ? (
                            <fieldset className={styles.storeTargetPills} aria-label="选择存放点">
                              {storeTargets.map((group) => (
                                <button
                                  key={group.key}
                                  type="button"
                                  className={styles.storeTargetChip}
                                  aria-pressed={group.key === storeTarget.key}
                                  disabled={usingItem}
                                  onClick={() => onSelectStorage(group.key)}
                                >
                                  {group.name}
                                </button>
                              ))}
                            </fieldset>
                          ) : (
                            <span className={styles.actionHint}>存入：{storeTarget.name}</span>
                          )}
                          <Button
                            small
                            disabled={usingItem}
                            onClick={() => {
                              const nextFallback = Math.max(selectedIndex, 0);
                              if (count <= 1) {
                                setPickedItem({
                                  id,
                                  entryType: "item",
                                  worn: selectedIsWorn,
                                  fallbackIndex: nextFallback,
                                });
                              }
                              void runDirectUse(
                                () =>
                                  onPlaceItem(
                                    "leave",
                                    id,
                                    storeTarget.target,
                                    selectedIsWorn ? "worn" : quick ? "quick" : "backpack",
                                  ),
                                `已将「${itemName(id)}」存入${storeTarget.name}`,
                                id,
                              );
                            }}
                          >
                            {usingItem
                              ? "正在处理…"
                              : count > 1
                                ? `存放 1 件到${storeTarget.name}`
                                : `存放到${storeTarget.name}`}
                          </Button>
                        </div>
                      ) : (
                        <div className={styles.storeMutedStrip}>
                          <span>{itemStoreBlocked ?? "当前不可存放"}</span>
                        </div>
                      )}
                    </footer>
                  </article>
                );
              })()}
          </div>
        )}
      </section>

      {places && (
        <section className={styles.placesBar} aria-label="当前地点公寓">
          <CellFrame />
          <span className={styles.placesLabel}>当前地点</span>
          <div className={styles.placesActions}>
            {view.safehouse.forSale.map((home) => (
              <div className={styles.placeItem} key={home.id}>
                <span>{home.locked ?? home.note}</span>
                {onBuyHome && !home.locked && (
                  <Button
                    small
                    disabled={home.price > view.money.eddies}
                    onClick={() => onBuyHome(home.id)}
                  >
                    买下{home.name}（{home.price.toLocaleString("en-US")} €$）
                  </Button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
