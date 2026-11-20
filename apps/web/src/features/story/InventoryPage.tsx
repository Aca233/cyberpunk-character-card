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

type InventoryFilter = "all" | "usable" | "weapon" | "clothing" | "mod" | "neural" | "misc";

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
};

const CLOTHING_SLOTS = inventoryRules.ClothingSlotSchema.options;

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.closest("input, textarea, select") !== null)
  );
}

/**
 * 随身物品栏（O）：紧凑 6 格混合着装条 + 个人神经槽 + 计数筛选/排序/搜索 + 全高双栏独立滚动 + 键盘快操。
 * 一级页签（随身 / 存放 / 车辆）与携带负担刻度由外层 Weapon 展开顶栏统一承载。
 */
export function InventoryPage({
  view,
  storageKey,
  onSelectStorage,
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
  const neuralSlots = view.shards.slots;
  const emptyNeuralSlots = Math.max(0, neuralSlots.max - neuralSlots.used);

  const [filter, setFilter] = useState<InventoryFilter>("all");
  const [clothingSlotFilter, setClothingSlotFilter] = useState<inventoryRules.ClothingSlot | null>(
    null,
  );
  const [sort, setSort] = useState<InventorySort>("default");
  const [search, setSearch] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [pickedItem, setPickedItem] = useState<{
    id: string;
    worn?: boolean;
    fallbackIndex?: number;
  } | null>(null);
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

  // 各类目数量统计
  const filterCounts = useMemo(() => {
    const counts: Record<InventoryFilter, number> = {
      all: allCarried.length,
      usable: 0,
      weapon: 0,
      clothing: 0,
      mod: 0,
      neural: 0,
      misc: 0,
    };
    for (const [id] of allCarried) {
      const detail = inventory.details?.[id];
      const kind = detail?.kind;
      const isNeural = Boolean(detail?.neuralGroup);
      if (isUsable(id)) counts.usable += 1;
      if (kind === "weapon") counts.weapon += 1;
      if (kind === "clothing") counts.clothing += 1;
      if (kind === "mod") counts.mod += 1;
      if (isNeural) counts.neural += 1;
      if (kind === "misc" && !isNeural) counts.misc += 1;
    }
    return counts;
  }, [allCarried, inventory.details, isUsable]);

  // 每个服装部位在背包中可穿的件数（用于在空着装格上提示“可穿 +N”）
  const bagClothingBySlot = useMemo(() => {
    const counts = new Map<inventoryRules.ClothingSlot, number>();
    for (const [id] of allCarried) {
      const detail = inventory.details?.[id];
      if (detail?.kind !== "clothing") continue;
      const slot =
        detail.clothingSlot ??
        CLOTHING_SLOTS.find((s) => detail.subLabel === inventoryRules.CLOTHING_SLOT_LABELS[s]) ??
        null;
      if (slot) counts.set(slot, (counts.get(slot) ?? 0) + 1);
    }
    return counts;
  }, [allCarried, inventory.details]);

  const wornBySlot = useMemo(
    () => new Map(inventory.clothing.map((entry) => [entry.slot, entry])),
    [inventory.clothing],
  );

  // 过滤 + 多字段搜索 + 排序
  const backpack = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const filtered = allCarried.filter(([id]) => {
      const detail = inventory.details?.[id];
      const kind = detail?.kind;
      const isNeural = Boolean(detail?.neuralGroup);
      const matchesFilter =
        filter === "all" ||
        (filter === "usable"
          ? isUsable(id)
          : filter === "neural"
            ? isNeural
            : filter === "misc"
              ? kind === "misc" && !isNeural
              : kind === filter);
      if (!matchesFilter) return false;

      if (clothingSlotFilter) {
        if (kind !== "clothing") return false;
        const slot =
          detail?.clothingSlot ??
          CLOTHING_SLOTS.find((s) => detail?.subLabel === inventoryRules.CLOTHING_SLOT_LABELS[s]) ??
          null;
        if (slot !== clothingSlotFilter) return false;
      }

      if (!query) return true;
      const chip = carriedChipById.get(id);
      const haystack = [
        itemName(id),
        detail?.subLabel ?? "",
        detail?.rarityLabel ?? "",
        detail?.ability ?? "",
        chip?.title ?? "",
        chip?.summary ?? "",
        chip?.categoryLabel ?? "",
      ]
        .join(" ")
        .toLocaleLowerCase();
      return haystack.includes(query);
    });

    if (sort === "default") return filtered;

    return [...filtered].sort(([idA], [idB]) => {
      const dA = inventory.details?.[idA];
      const dB = inventory.details?.[idB];
      if (sort === "rarity") {
        const iconicDiff = Number(Boolean(dB?.iconic)) - Number(Boolean(dA?.iconic));
        if (iconicDiff !== 0) return iconicDiff;
        const rA = RARITY_RANK[dA?.rarity ?? inventory.rarity[idA] ?? ""] ?? 0;
        const rB = RARITY_RANK[dB?.rarity ?? inventory.rarity[idB] ?? ""] ?? 0;
        if (rB !== rA) return rB - rA;
      } else if (sort === "kind") {
        const kA = KIND_RANK[dA?.kind ?? "misc"] ?? 9;
        const kB = KIND_RANK[dB?.kind ?? "misc"] ?? 9;
        if (kA !== kB) return kA - kB;
      } else if (sort === "carry") {
        const cA = dA?.carryUnits ?? 0;
        const cB = dB?.carryUnits ?? 0;
        if (cB !== cA) return cB - cA;
      }
      return itemName(idA).localeCompare(itemName(idB), "zh-Hans-CN");
    });
  }, [
    allCarried,
    carriedChipById,
    clothingSlotFilter,
    filter,
    inventory.details,
    inventory.rarity,
    isUsable,
    itemName,
    search,
    sort,
  ]);

  // 智能焦点保持：支持武器改装物化 ID 变化追踪 + 物品耗尽/存入后就近邻项补位
  const wornMatch = pickedItem?.worn
    ? inventory.clothing.find((c) => c.id === pickedItem.id)
    : undefined;
  const packMatch =
    !wornMatch && !pickedItem?.worn && pickedItem?.id
      ? (backpack.find(([id]) => id === pickedItem.id) ??
        backpack.find(
          ([id]) =>
            inventory.details?.[id]?.baseId ===
            (inventory.details?.[pickedItem.id]?.baseId ?? baseWeaponIdOf(pickedItem.id)),
        ))
      : undefined;
  const fallbackEntry =
    pickedItem?.fallbackIndex !== undefined && backpack.length > 0
      ? backpack[Math.min(pickedItem.fallbackIndex, backpack.length - 1)]
      : backpack[0];
  const selectedEntry = wornMatch
    ? ([wornMatch.id, 1] as const)
    : (packMatch ?? fallbackEntry ?? null);
  const selectedId = selectedEntry?.[0] ?? null;
  const selectedIsWorn = Boolean(wornMatch);
  const selectedIndex = selectedIsWorn ? -1 : backpack.findIndex(([id]) => id === selectedId);

  const selectItem = useCallback((id: string, worn = false, fallbackIndex?: number) => {
    setPickedItem(fallbackIndex === undefined ? { id, worn } : { id, worn, fallbackIndex });
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
    if (!selectedEntry) return null;
    const [id, count] = selectedEntry;
    const to = selectedIsWorn ? undefined : inventory.equipTo[id];
    const detail = inventory.details?.[id];
    const chip = selectedIsWorn ? undefined : carriedChipById.get(id);
    const quick = selectedIsWorn ? undefined : quickItems.find((q) => q.id === id);
    const kind = detail?.kind;
    const usable =
      !selectedIsWorn && (kind === "healing" || kind === "grenade" || kind === "consumable");
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
    selectedIsWorn,
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
        setPickedItem({ id, worn: true });
        showReceipt(`已穿上「${itemName(id)}」`, id);
      } else {
        setPickedItem({ id, worn: false });
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
      setPickedItem({ id, worn: false });
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

  // 安全快操：双击列表项或按 Enter 时执行“穿上 / 设为当前补给 / 非战斗治疗或压制剂 / 切至可装槽位”
  const triggerSafePrimary = useCallback(
    (id: string) => {
      if (disabledReason || usingItem) return;
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
      onSuppressant,
      quickItems,
      runDirectUse,
      selectedCtx,
      triggerEquip,
      usingItem,
      view.combat.active,
    ],
  );

  // 分层 Esc 接入全局面板栈：先关改装抽屉 → 退搜索框 → 清搜索/部位筛选 → 最后交回外层关面板
  useLayer(
    () => {
      if (openSlotPicker) {
        setOpenSlotPicker(null);
      } else if (searchFocused) {
        if (search) setSearch("");
        searchRef.current?.blur();
      } else {
        setSearch("");
        setClothingSlotFilter(null);
      }
    },
    Boolean(openSlotPicker || searchFocused || search || clothingSlotFilter),
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
        if (backpack.length === 0) return;
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        const cur = selectedIndex < 0 ? (delta > 0 ? -1 : 0) : selectedIndex;
        const nextIdx = (cur + delta + backpack.length) % backpack.length;
        const nextEntry = backpack[nextIdx];
        if (nextEntry) {
          selectItem(nextEntry[0], false, nextIdx);
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
        if (selectedId && !selectedIsWorn) {
          event.preventDefault();
          triggerSafePrimary(selectedId);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [backpack, selectItem, selectedId, selectedIndex, selectedIsWorn, triggerSafePrimary]);

  const showNeuralSlots = filter === "neural" || (filter === "all" && neuralSlots.used > 0);
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

      {/* 紧凑 6 格混合着装条：已穿显示缩略图与名称，空槽点击筛选对应部位服装 */}
      <section className={styles.clothingBar} aria-label="6 格随身着装">
        <ul className={styles.clothingGrid}>
          {CLOTHING_SLOTS.map((slot) => {
            const slotLabel = inventoryRules.CLOTHING_SLOT_LABELS[slot];
            const worn = wornBySlot.get(slot);
            const matchCount = bagClothingBySlot.get(slot) ?? 0;
            const isSelected = Boolean(worn && selectedIsWorn && selectedId === worn.id);
            const isFilteringSlot = !worn && clothingSlotFilter === slot;
            const art = worn ? itemArtOf(worn.id) : undefined;

            if (worn) {
              return (
                <li
                  key={slot}
                  className={styles.clothingCell}
                  data-active={isSelected || undefined}
                >
                  <CellFrame />
                  <button
                    type="button"
                    className={styles.clothingCellBtn}
                    aria-pressed={isSelected}
                    title={`${slotLabel}：${itemName(worn.id)}（点击查看详情）`}
                    onClick={() => selectItem(worn.id, true)}
                  >
                    {art && (
                      <span className={styles.clothingThumb} aria-hidden>
                        <Asset id={art} className={styles.clothingThumbArt} />
                      </span>
                    )}
                    <span className={styles.clothingCopy}>
                      <span className={styles.clothingSlotLabel}>{slotLabel}</span>
                      <b className={styles.clothingName}>{itemName(worn.id)}</b>
                    </span>
                  </button>
                  {onUnequip && (
                    <button
                      type="button"
                      className={styles.clothingUnequip}
                      aria-label={`脱下${itemName(worn.id)}`}
                      title={`脱下${itemName(worn.id)}`}
                      disabled={usingItem || Boolean(disabledReason)}
                      onClick={() => triggerUnequip(worn.id)}
                    >
                      ×
                    </button>
                  )}
                </li>
              );
            }

            return (
              <li
                key={slot}
                className={styles.clothingCell}
                data-empty=""
                data-has-match={matchCount > 0 || undefined}
                data-filtering={isFilteringSlot || undefined}
              >
                <CellFrame />
                <button
                  type="button"
                  className={styles.clothingCellBtn}
                  aria-pressed={isFilteringSlot}
                  title={
                    matchCount > 0
                      ? `${slotLabel}空余 · 背包有 ${matchCount} 件可穿，点击筛选`
                      : `${slotLabel}空余 · 背包暂无对应服装`
                  }
                  onClick={() => {
                    if (isFilteringSlot) {
                      setClothingSlotFilter(null);
                    } else {
                      setFilter("clothing");
                      setClothingSlotFilter(slot);
                      setPickedItem(null);
                    }
                  }}
                >
                  <span className={styles.clothingCopy}>
                    <span className={styles.clothingSlotLabel}>
                      <span>{slotLabel}</span>
                      {matchCount > 0 && <b className={styles.clothingMatchPill}>+{matchCount}</b>}
                    </span>
                    <span className={styles.clothingEmptyLabel}>
                      {isFilteringSlot ? "筛选中" : "未穿戴"}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {/* 个人神经芯片槽（仅切至芯片/超梦或已有插槽占用时展示，统一 CellFrame 材质） */}
      {showNeuralSlots && (
        <section className={styles.neuralStrip} aria-label="个人神经芯片槽">
          <CellFrame />
          <div className={styles.neuralHead}>
            <span className={styles.neuralTitle}>
              个人神经芯片槽 · {neuralSlots.used}/{neuralSlots.max}
            </span>
            <span className={styles.neuralMeta}>
              {view.shards.hasReader
                ? "已携隔离读写器（可离线查毒/破译）"
                : "未携隔离读写器（直插未知加密片有风险）"}
            </span>
          </div>
          <div className={styles.neuralGrid}>
            {neuralSlots.items.map((slot) => {
              const isSlotSelected = !selectedIsWorn && selectedId === slot.carrier;
              return (
                <button
                  key={slot.carrier}
                  type="button"
                  className={styles.neuralSlot}
                  data-active={isSlotSelected || undefined}
                  onClick={() => {
                    if (filter !== "all" && filter !== "neural") setFilter("neural");
                    setClothingSlotFilter(null);
                    selectItem(slot.carrier);
                  }}
                >
                  <strong>{slot.title}</strong>
                  <span className={styles.neuralSlotSub}>
                    {slot.categoryLabel}
                    {slot.protocol ? ` · ${slot.protocol}` : ""} · 接入于 {slot.at}
                  </span>
                </button>
              );
            })}
            {Array.from({ length: emptyNeuralSlots }, (_, index) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: 空槽按序号占位
                key={`empty-${index}`}
                className={`${styles.neuralSlot} ${styles.neuralSlotEmpty}`}
              >
                <span>空余神经槽</span>
                <span className={styles.neuralSlotSub}>可插入技能或行为协议芯片</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 背包主区：筛选 + 排序 + 搜索 + 全高双栏独立滚动 */}
      <section className={styles.packSection} aria-label="随身背包">
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
                  if (key !== "clothing") setClothingSlotFilter(null);
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

        {clothingSlotFilter && (
          <div className={styles.slotFilterBar} role="status">
            <span>
              正在筛选「{inventoryRules.CLOTHING_SLOT_LABELS[clothingSlotFilter]}」部位可穿服装
            </span>
            <button
              type="button"
              className={styles.slotFilterClear}
              onClick={() => setClothingSlotFilter(null)}
            >
              清除部位筛选
            </button>
          </div>
        )}

        {backpack.length === 0 && !selectedIsWorn ? (
          <div className={styles.emptyBox}>
            <CellFrame />
            <span>
              {allCarried.length === 0
                ? "随身背包是空的。"
                : search || clothingSlotFilter || filter !== "all"
                  ? "没有符合当前筛选条件的物品。"
                  : "随身背包是空的。"}
            </span>
            {(search || clothingSlotFilter || filter !== "all") && (
              <ActionButton
                onClick={() => {
                  setFilter("all");
                  setClothingSlotFilter(null);
                  setSearch("");
                }}
              >
                重置全部筛选
              </ActionButton>
            )}
          </div>
        ) : (
          <div className={styles.browser}>
            {backpack.length === 0 ? (
              <div className={styles.emptyBox}>
                <CellFrame />
                <span>没有符合筛选条件的背包物品。</span>
                {(search || clothingSlotFilter || filter !== "all") && (
                  <ActionButton
                    onClick={() => {
                      setFilter("all");
                      setClothingSlotFilter(null);
                      setSearch("");
                    }}
                  >
                    重置筛选
                  </ActionButton>
                )}
              </div>
            ) : (
              <ul ref={listRef} className={styles.itemList} aria-label="选择背包物品">
                {backpack.map(([id, count], index) => {
                  const quick = quickItems.find((item) => item.id === id);
                  const detail = inventory.details?.[id];
                  const chip = carriedChipById.get(id);
                  const art = itemArtOf(detail?.baseId ?? id);
                  const rarity = detail?.rarity ?? inventory.rarity[id];
                  const isSelected = !selectedIsWorn && selectedId === id;
                  const isHeld =
                    detail?.kind === "weapon" && Boolean(inventory.heldWeapons?.includes(id));
                  const isSilenced =
                    detail?.kind === "weapon" &&
                    detail.noise === "silent" &&
                    !detail.subLabel.includes("刀剑") &&
                    !detail.subLabel.includes("钝器");
                  const modSlots = detail?.kind === "weapon" ? detail.modSlots : [];
                  const carryUnits = detail?.carryUnits ?? 0;
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
                    <li key={id}>
                      <button
                        type="button"
                        data-item-index={index}
                        className={styles.itemRow}
                        aria-pressed={isSelected}
                        data-rarity={rarity ?? undefined}
                        data-iconic={detail?.iconic || undefined}
                        data-flash={flashId === id || undefined}
                        onClick={() => selectItem(id, false, index)}
                        onDoubleClick={() => {
                          selectItem(id, false, index);
                          triggerSafePrimary(id);
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
                                  {detail?.subLabel ?? "物品"}
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
            )}

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
                              if (count <= 1 && !selectedIsWorn) {
                                setPickedItem({
                                  id,
                                  worn: false,
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
