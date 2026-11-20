import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActionButton } from "../../ui/ActionButton";
import { Asset, cssUrl, NineSlice } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { CellFrame, FrameBox } from "../../ui/FrameBox";
import { useLayer } from "../../ui/layers";
import { itemArtOf } from "./art";
import inv from "./inventory.module.css";
import styles from "./inventory-storage.module.css";
import { displayItemName, type View } from "./view";

export type PlaceInventoryItem = (
  action: "leave" | "take",
  item: string,
  where: string,
  source?: "backpack" | "worn" | "quick",
  count?: number,
) => Promise<void>;

type StorageGroup = View["safehouse"]["storage"][number];
type StoredItem = StorageGroup["items"][number];
type StorageFilter = "all" | "weapon" | "clothing" | "mod" | "usable" | "misc";
type ActivePane = "carried" | "stored";

interface CarriedTransferRow {
  readonly key: string;
  readonly id: string;
  readonly baseId: string;
  readonly name: string;
  readonly kind: string;
  readonly subLabel: string;
  readonly rarity: string | null;
  readonly rarityLabel: string | null;
  readonly iconic: boolean;
  readonly carryUnits: number;
  readonly ability: string;
  readonly count: number;
  readonly source: "backpack" | "worn" | "quick";
  readonly badge: string | null;
  readonly remaining: number | null;
  readonly charges: number | null;
  readonly blockedReason: string | null;
}

const CELL_SLICE = [20, 30, 30, 20] as const;

const KIND_LABELS: Record<StorageGroup["kind"], string> = {
  home: "住处",
  vehicle: "车辆",
  npc: "他人",
  place: "场景",
};

const KIND_RANK: Record<string, number> = {
  weapon: 0,
  healing: 1,
  grenade: 2,
  consumable: 3,
  clothing: 4,
  mod: 5,
  cyberware: 6,
  misc: 7,
};

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.closest("input, textarea, select") !== null)
  );
}

function matchesStorageFilter(kind: string, filter: StorageFilter): boolean {
  if (filter === "all") return true;
  if (filter === "usable") {
    return kind === "healing" || kind === "grenade" || kind === "consumable";
  }
  if (filter === "misc") {
    return (
      kind !== "weapon" &&
      kind !== "clothing" &&
      kind !== "mod" &&
      kind !== "healing" &&
      kind !== "grenade" &&
      kind !== "consumable"
    );
  }
  return kind === filter;
}

/** 存放物品工作台：现场可达时提供随身↔存放点双向存取与批量操作；远端存放点降级为只读浏览 */
export function InventoryStorage({
  view,
  groups,
  selectedKey,
  onSelect,
  onPlaceItem,
  busy,
  disabledReason,
}: {
  readonly view: View;
  readonly groups: readonly StorageGroup[];
  readonly selectedKey: string | null;
  readonly onSelect: (key: string) => void;
  readonly onPlaceItem: PlaceInventoryItem | undefined;
  readonly busy: boolean;
  readonly disabledReason: string | undefined;
}) {
  const [filter, setFilter] = useState<StorageFilter>("all");
  const [search, setSearch] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [activePane, setActivePane] = useState<ActivePane>("stored");
  const [pickedStored, setPickedStored] = useState<{ id: string; fallbackIndex?: number } | null>(
    null,
  );
  const [pickedCarried, setPickedCarried] = useState<{
    key: string;
    fallbackIndex?: number;
  } | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const receiptTimer = useRef<number | undefined>(undefined);
  const searchRef = useRef<HTMLInputElement>(null);
  const storedListRef = useRef<HTMLUListElement>(null);
  const carriedListRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    return () => window.clearTimeout(receiptTimer.current);
  }, []);

  const showReceipt = useCallback((text: string) => {
    window.clearTimeout(receiptTimer.current);
    setReceipt(text);
    receiptTimer.current = window.setTimeout(() => setReceipt(null), 2200);
  }, []);

  const group =
    groups.find((entry) => entry.key === selectedKey) ??
    groups.find((entry) => entry.canTake || entry.canStore) ??
    groups[0];

  const isWorkbench = Boolean(group && (group.canStore || group.canTake));
  const groupItems = group?.items ?? [];

  // 随身可存物品列表：背包（可批量）+ 快捷栏（单件）+ 穿着（单件）
  const carriedRows = useMemo<CarriedTransferRow[]>(() => {
    const { inventory, names, shards } = view;
    const slottedIds = new Set(shards.carried.filter((c) => c.slotted).map((c) => c.carrier));
    const heldWeaponIds = new Set(inventory.heldWeapons ?? []);
    const rows: CarriedTransferRow[] = [];

    for (const [id, count] of Object.entries(inventory.backpack)) {
      if (count <= 0) continue;
      const detail = inventory.details?.[id];
      const baseId = detail?.baseId ?? id;
      rows.push({
        key: `backpack:${id}`,
        id,
        baseId,
        name: displayItemName(names.items, id, baseId),
        kind: detail?.kind ?? "misc",
        subLabel: detail?.subLabel ?? "物品",
        rarity: detail?.rarity ?? inventory.rarity[id] ?? null,
        rarityLabel: detail?.rarityLabel ?? null,
        iconic: Boolean(detail?.iconic),
        carryUnits: detail?.carryUnits ?? 0,
        ability: detail?.ability ?? "",
        count,
        source: "backpack",
        badge: slottedIds.has(id) ? "已插槽" : heldWeaponIds.has(id) ? "持用" : null,
        remaining: detail?.remaining ?? null,
        charges: detail?.charges ?? null,
        blockedReason: slottedIds.has(id) ? "请先从个人神经芯片槽拔下后再存放" : null,
      });
    }

    const quickSlots = [
      inventory.healing ? { slot: inventory.healing, label: "治疗槽" } : null,
      inventory.grenade ? { slot: inventory.grenade, label: "手雷槽" } : null,
    ];
    for (const entry of quickSlots) {
      if (!entry || entry.slot.charges <= 0) continue;
      const { id, charges, max } = entry.slot;
      const detail = inventory.details?.[id];
      const baseId = detail?.baseId ?? id;
      rows.push({
        key: `quick:${id}`,
        id,
        baseId,
        name: displayItemName(names.items, id, baseId),
        kind: detail?.kind ?? "consumable",
        subLabel: detail?.subLabel ?? entry.label,
        rarity: detail?.rarity ?? null,
        rarityLabel: detail?.rarityLabel ?? null,
        iconic: Boolean(detail?.iconic),
        carryUnits: detail?.carryUnits ?? 0,
        ability: detail?.ability ?? "",
        count: 1,
        source: "quick",
        badge: entry.label,
        remaining: charges,
        charges: max,
        blockedReason: null,
      });
    }

    for (const worn of inventory.clothing) {
      const detail = inventory.details?.[worn.id];
      const baseId = detail?.baseId ?? worn.id;
      rows.push({
        key: `worn:${worn.slot}:${worn.id}`,
        id: worn.id,
        baseId,
        name: displayItemName(names.items, worn.id, baseId),
        kind: "clothing",
        subLabel: detail?.subLabel ?? worn.label,
        rarity: detail?.rarity ?? null,
        rarityLabel: detail?.rarityLabel ?? null,
        iconic: Boolean(detail?.iconic),
        carryUnits: detail?.carryUnits ?? 0,
        ability: detail?.ability ?? "",
        count: 1,
        source: "worn",
        badge: `穿着·${worn.label}`,
        remaining: null,
        charges: null,
        blockedReason: null,
      });
    }

    rows.sort((a, b) => {
      // 大件/高负担优先靠前，方便快速减负；同类按品级与名称稳定排序
      if (a.carryUnits !== b.carryUnits) return b.carryUnits - a.carryUnits;
      const kr = (KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9);
      if (kr !== 0) return kr;
      return a.name.localeCompare(b.name, "zh-Hans-CN");
    });
    return rows;
  }, [view]);

  const filterCounts = useMemo(() => {
    const counts: Record<StorageFilter, number> = {
      all: 0,
      weapon: 0,
      clothing: 0,
      mod: 0,
      usable: 0,
      misc: 0,
    };
    const pool = isWorkbench
      ? [...carriedRows.map((r) => r.kind), ...groupItems.map((r) => r.kind)]
      : groupItems.map((r) => r.kind);
    counts.all = pool.length;
    for (const kind of pool) {
      if (kind === "weapon") counts.weapon += 1;
      else if (kind === "clothing") counts.clothing += 1;
      else if (kind === "mod") counts.mod += 1;
      else if (kind === "healing" || kind === "grenade" || kind === "consumable") {
        counts.usable += 1;
      } else {
        counts.misc += 1;
      }
    }
    return counts;
  }, [carriedRows, groupItems, isWorkbench]);

  const visibleCarried = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return carriedRows.filter((row) => {
      if (!matchesStorageFilter(row.kind, filter)) return false;
      if (!query) return true;
      return `${row.name} ${row.subLabel} ${row.rarityLabel ?? ""} ${row.badge ?? ""} ${row.ability}`
        .toLocaleLowerCase()
        .includes(query);
    });
  }, [carriedRows, filter, search]);

  const visibleStored = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return groupItems.filter((entry) => {
      if (!matchesStorageFilter(entry.kind, filter)) return false;
      if (!query) return true;
      return `${entry.name} ${entry.subLabel} ${entry.rarityLabel ?? ""} ${entry.ability ?? ""}`
        .toLocaleLowerCase()
        .includes(query);
    });
  }, [filter, groupItems, search]);

  const selectedStoredIndex = useMemo(() => {
    if (visibleStored.length === 0) return -1;
    if (pickedStored?.id) {
      const exact = visibleStored.findIndex((entry) => entry.id === pickedStored.id);
      if (exact >= 0) return exact;
    }
    if (pickedStored?.fallbackIndex !== undefined) {
      return Math.min(pickedStored.fallbackIndex, visibleStored.length - 1);
    }
    return 0;
  }, [pickedStored, visibleStored]);

  const selectedCarriedIndex = useMemo(() => {
    if (visibleCarried.length === 0) return -1;
    if (pickedCarried?.key) {
      const exact = visibleCarried.findIndex((entry) => entry.key === pickedCarried.key);
      if (exact >= 0) return exact;
    }
    if (pickedCarried?.fallbackIndex !== undefined) {
      return Math.min(pickedCarried.fallbackIndex, visibleCarried.length - 1);
    }
    return 0;
  }, [pickedCarried, visibleCarried]);

  const selectedStored = selectedStoredIndex >= 0 ? visibleStored[selectedStoredIndex] : undefined;
  const selectedCarried =
    selectedCarriedIndex >= 0 ? visibleCarried[selectedCarriedIndex] : undefined;

  // 若当前聚焦侧已清空而另一侧还有物品，自动切到有物品的一侧
  const effectivePane: ActivePane = !isWorkbench
    ? "stored"
    : activePane === "carried"
      ? selectedCarried
        ? "carried"
        : selectedStored
          ? "stored"
          : "carried"
      : selectedStored
        ? "stored"
        : selectedCarried
          ? "carried"
          : "stored";

  const takeBlocked = !group
    ? "没有可用存放点"
    : disabledReason ||
      (busy
        ? "正在处理物品，请稍候"
        : !group.canTake
          ? (group.blockedReason ?? "当前只能查看此处物品")
          : !onPlaceItem
            ? "当前无法取回物品"
            : undefined);

  const storeBlocked = !group
    ? "没有可用存放点"
    : disabledReason ||
      (busy
        ? "正在处理物品，请稍候"
        : !group.canStore
          ? (group.blockedReason ?? "当前无法向此处存放物品")
          : !onPlaceItem
            ? "当前无法存放物品"
            : undefined);

  const handleTake = useCallback(
    async (entry: StoredItem, index: number, quantity = 1) => {
      if (!group || takeBlocked || !onPlaceItem) return;
      const amount = Math.max(1, Math.min(quantity, entry.count, 99));
      setActionError("");
      if (amount >= entry.count) {
        setPickedStored({ id: entry.id, fallbackIndex: index });
      }
      try {
        await onPlaceItem("take", entry.id, group.target, undefined, amount);
        showReceipt(
          amount > 1
            ? `已从${group.name}取回「${entry.name}」×${amount}`
            : `已从${group.name}取回「${entry.name}」`,
        );
      } catch (error) {
        setActionError(error instanceof Error ? error.message : "取回失败，请重试");
      }
    },
    [group, onPlaceItem, showReceipt, takeBlocked],
  );

  const handleStore = useCallback(
    async (entry: CarriedTransferRow, index: number, quantity = 1) => {
      if (!group || storeBlocked || !onPlaceItem || entry.blockedReason) return;
      const maxBatch = entry.source === "backpack" ? Math.min(entry.count, 99) : 1;
      const amount = Math.max(1, Math.min(quantity, maxBatch));
      setActionError("");
      if (amount >= entry.count) {
        setPickedCarried({ key: entry.key, fallbackIndex: index });
      }
      try {
        await onPlaceItem("leave", entry.id, group.target, entry.source, amount);
        showReceipt(
          amount > 1
            ? `已将「${entry.name}」×${amount} 存入${group.name}`
            : `已将「${entry.name}」存入${group.name}`,
        );
      } catch (error) {
        setActionError(error instanceof Error ? error.message : "存放失败，请重试");
      }
    },
    [group, onPlaceItem, showReceipt, storeBlocked],
  );

  // 分层 Esc 接入全局面板栈：先退搜索框 / 清搜索，再交回外层关面板
  useLayer(
    () => {
      if (searchFocused) {
        if (search) setSearch("");
        searchRef.current?.blur();
      } else {
        setSearch("");
      }
    },
    Boolean(searchFocused || search),
  );

  // 键盘导航：↑/↓ 选物品，←/→ 切左右栏，/ 聚焦搜索，Enter 存/取 1 件，Shift+Enter 全部存/取
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

      if (isWorkbench && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        const nextPane: ActivePane = event.key === "ArrowLeft" ? "carried" : "stored";
        if (nextPane !== effectivePane) {
          event.preventDefault();
          setActivePane(nextPane);
        }
        return;
      }

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const delta = event.key === "ArrowDown" ? 1 : -1;
        if (effectivePane === "carried") {
          if (visibleCarried.length === 0) return;
          event.preventDefault();
          const cur = Math.max(selectedCarriedIndex, 0);
          const nextIdx = (cur + delta + visibleCarried.length) % visibleCarried.length;
          const nextItem = visibleCarried[nextIdx];
          if (nextItem) {
            setPickedCarried({ key: nextItem.key, fallbackIndex: nextIdx });
            carriedListRef.current
              ?.querySelector<HTMLElement>(`[data-carried-index="${nextIdx}"]`)
              ?.scrollIntoView({ block: "nearest" });
          }
          return;
        }
        if (visibleStored.length === 0) return;
        event.preventDefault();
        const cur = Math.max(selectedStoredIndex, 0);
        const nextIdx = (cur + delta + visibleStored.length) % visibleStored.length;
        const nextItem = visibleStored[nextIdx];
        if (nextItem) {
          setPickedStored({ id: nextItem.id, fallbackIndex: nextIdx });
          storedListRef.current
            ?.querySelector<HTMLElement>(`[data-storage-index="${nextIdx}"]`)
            ?.scrollIntoView({ block: "nearest" });
        }
        return;
      }

      if (event.key === "Enter" && !event.repeat) {
        const activeEl = document.activeElement;
        if (
          activeEl instanceof HTMLElement &&
          activeEl.closest("button") &&
          !activeEl.hasAttribute("data-storage-index") &&
          !activeEl.hasAttribute("data-carried-index")
        ) {
          return;
        }
        if (effectivePane === "carried" && selectedCarried && !storeBlocked) {
          if (selectedCarried.blockedReason) return;
          event.preventDefault();
          const qty =
            event.shiftKey && selectedCarried.source === "backpack" ? selectedCarried.count : 1;
          void handleStore(selectedCarried, selectedCarriedIndex, qty);
        } else if (effectivePane === "stored" && selectedStored && !takeBlocked) {
          event.preventDefault();
          const qty = event.shiftKey ? selectedStored.count : 1;
          void handleTake(selectedStored, selectedStoredIndex, qty);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    effectivePane,
    handleStore,
    handleTake,
    isWorkbench,
    selectedCarried,
    selectedCarriedIndex,
    selectedStored,
    selectedStoredIndex,
    storeBlocked,
    takeBlocked,
    visibleCarried,
    visibleStored,
  ]);

  if (!group) {
    return (
      <div className={inv.emptyBox}>
        <CellFrame />
        <span>还没有已登记的存放位置。获得住处或车辆后，可在现场存取物品。</span>
      </div>
    );
  }

  const totalStoredUnits = group.items.reduce((sum, entry) => sum + entry.count, 0);
  const totalCarriedUnits = carriedRows.reduce((sum, entry) => sum + entry.count, 0);
  const load = view.inventory.loadout;
  const filterTabs: readonly (readonly [StorageFilter, string, number])[] = [
    ["all", "全部", filterCounts.all],
    ["weapon", "武器", filterCounts.weapon],
    ["usable", "可用", filterCounts.usable],
    ["clothing", "服装", filterCounts.clothing],
    ["mod", "改装件", filterCounts.mod],
    ["misc", "杂物", filterCounts.misc],
  ];

  // 工作台底部焦点详情（随当前高亮侧联动）
  const focusedItem =
    effectivePane === "carried" && selectedCarried
      ? {
          side: "carried" as const,
          row: selectedCarried,
          art: itemArtOf(selectedCarried.baseId),
          blocked: selectedCarried.blockedReason ?? storeBlocked,
          batchCount:
            selectedCarried.source === "backpack" ? Math.min(selectedCarried.count, 99) : 1,
        }
      : selectedStored
        ? {
            side: "stored" as const,
            row: selectedStored,
            art: itemArtOf(selectedStored.baseId ?? selectedStored.id),
            blocked: takeBlocked,
            batchCount: Math.min(selectedStored.count, 99),
          }
        : null;

  const readOnlyArt = selectedStored
    ? itemArtOf(selectedStored.baseId ?? selectedStored.id)
    : undefined;

  return (
    <section className={styles.storageRoot} aria-label="存放物品">
      {(disabledReason || actionError || receipt) && (
        <div className={inv.bannerStack}>
          {disabledReason && (
            <p role="status" className={inv.noticeBanner}>
              <span>{disabledReason}</span>
            </p>
          )}
          {actionError && (
            <p role="alert" className={inv.errorBanner}>
              <span>{actionError}</span>
            </p>
          )}
          {receipt && (
            <p role="status" className={inv.receiptBanner}>
              <span>{receipt}</span>
            </p>
          )}
        </div>
      )}

      {/* 存放点切换芯片条 */}
      <nav className={styles.locationTabs} aria-label="切换存放位置">
        {groups.map((entry) => {
          const entryCount = entry.items.reduce((sum, row) => sum + row.count, 0);
          const reachable = entry.canTake || entry.canStore;
          return (
            <button
              key={entry.key}
              type="button"
              className={styles.locationChip}
              aria-pressed={entry.key === group.key}
              title={`${entry.name} · ${entry.locationName}${reachable ? "（就在附近，可直接双向存取）" : "（远端只读）"}`}
              onClick={() => {
                onSelect(entry.key);
                setPickedStored(null);
                setFilter("all");
                setSearch("");
                setActionError("");
              }}
            >
              <i
                className={styles.locationDot}
                data-reachable={reachable || undefined}
                aria-hidden
              />
              <span className={styles.locationChipKind}>{KIND_LABELS[entry.kind]}</span>
              <span className={styles.locationChipName}>{entry.name}</span>
              <span className={styles.locationChipSub}>{entry.locationName}</span>
              <b className={styles.locationChipCount}>{entryCount}</b>
            </button>
          );
        })}
      </nav>

      {/* 当前存放点状态与负重摘要 */}
      <div className={styles.groupSummary} data-locked={!isWorkbench || undefined}>
        <div className={styles.groupSummaryMain}>
          <span className={styles.groupSummaryTitle}>
            {group.name} · {group.locationName}
          </span>
          <span className={styles.groupSummaryMeta}>
            存放 {totalStoredUnits} 件 · {isWorkbench ? "现场可达，支持直接双向存取" : "远端只读"}
          </span>
        </div>
        {isWorkbench && (
          <span
            className={styles.loadBadge}
            data-level={load.carryLevel}
            title={`当前随身负担 ${load.carryUnits}/${load.carryMax}（${load.carryLabel}）`}
          >
            随身负担 {load.carryUnits}/{load.carryMax} · {load.carryLabel}
          </span>
        )}
        {group.blockedReason && (
          <p className={styles.groupBlocked} role="status">
            {group.blockedReason}
          </p>
        )}
      </div>

      {/* 公共筛选 + 搜索 */}
      {(groupItems.length > 0 || (isWorkbench && carriedRows.length > 0)) && (
        <div className={inv.toolbar}>
          <nav className={inv.filterRow} aria-label="物品分类筛选">
            {filterTabs.map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                className={inv.filterChip}
                aria-pressed={filter === key}
                data-zero={count === 0 && key !== "all" ? "" : undefined}
                onClick={() => {
                  setFilter(key);
                  setPickedStored(null);
                  setPickedCarried(null);
                }}
              >
                <span>{label}</span>
                {count > 0 && <b className={inv.filterChipCount}>{count}</b>}
              </button>
            ))}
          </nav>
          <div className={inv.toolbarRight}>
            <FrameBox className={inv.searchBox}>
              <input
                ref={searchRef}
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                placeholder={isWorkbench ? "同搜随身与存放…" : "搜存放物品…"}
                aria-label={isWorkbench ? "搜索随身与存放物品" : "搜索存放物品"}
                className={inv.searchInput}
              />
              {search ? (
                <button
                  type="button"
                  className={inv.searchClear}
                  aria-label="清空搜索"
                  onClick={() => setSearch("")}
                >
                  ×
                </button>
              ) : (
                <kbd className={inv.searchKey} aria-hidden>
                  /
                </kbd>
              )}
            </FrameBox>
          </div>
        </div>
      )}

      {isWorkbench ? (
        <>
          {/* 现场可达：随身 ↔ 存放点 双向传输工作台 */}
          <div className={styles.workbench}>
            {/* 左列：随身物品（点击行选中，右侧快操按钮或双击直接存入） */}
            <section
              className={styles.pane}
              data-active={effectivePane === "carried" || undefined}
              aria-label="随身可存物品"
            >
              <header className={styles.paneHead}>
                <span className={styles.paneTitle}>随身携带</span>
                <span className={styles.paneMeta}>
                  {visibleCarried.length !== carriedRows.length
                    ? `${visibleCarried.length}/${carriedRows.length} 项`
                    : `${totalCarriedUnits} 件`}
                </span>
              </header>

              {visibleCarried.length === 0 ? (
                <div className={styles.paneEmpty}>
                  <span>
                    {carriedRows.length === 0 ? "随身没有可存放的物品。" : "随身无匹配项。"}
                  </span>
                </div>
              ) : (
                <ul ref={carriedListRef} className={styles.paneList}>
                  {visibleCarried.map((entry, index) => {
                    const entryArt = itemArtOf(entry.baseId);
                    const isSelected =
                      effectivePane === "carried" && selectedCarried?.key === entry.key;
                    const rowBlocked = Boolean(entry.blockedReason || storeBlocked);
                    const canBatch = entry.source === "backpack" && entry.count > 1;
                    return (
                      <li key={entry.key} className={styles.transferItem}>
                        <div
                          className={styles.transferRow}
                          data-selected={isSelected || undefined}
                          data-rarity={entry.rarity ?? undefined}
                          data-iconic={entry.iconic || undefined}
                          data-blocked={rowBlocked || undefined}
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
                          {entry.rarity && (
                            <NineSlice
                              id="cyber.cellRarity"
                              tint="var(--rarity)"
                              slice={0}
                              className={inv.itemRarityBar}
                            />
                          )}
                          <button
                            type="button"
                            data-carried-index={index}
                            className={styles.transferSelect}
                            aria-pressed={isSelected}
                            onClick={() => {
                              setActivePane("carried");
                              setPickedCarried({ key: entry.key, fallbackIndex: index });
                            }}
                            onDoubleClick={() => {
                              setActivePane("carried");
                              setPickedCarried({ key: entry.key, fallbackIndex: index });
                              if (!rowBlocked) void handleStore(entry, index, 1);
                            }}
                          >
                            <span className={styles.miniThumb} aria-hidden>
                              {entryArt ? (
                                <Asset id={entryArt} className={inv.itemArt} />
                              ) : (
                                <Asset id="notify.inventory" tint="var(--cp-cyan)" height={15} />
                              )}
                            </span>
                            <span className={styles.transferInfo}>
                              <span className={styles.transferNameLine}>
                                <strong className={styles.transferName}>{entry.name}</strong>
                                {entry.count > 1 && (
                                  <b className={styles.transferCount}>×{entry.count}</b>
                                )}
                              </span>
                              <span className={styles.transferSub}>
                                {entry.badge && (
                                  <span className={styles.sourceTag}>{entry.badge}</span>
                                )}
                                <span>{entry.subLabel}</span>
                                {entry.carryUnits > 0 && (
                                  <span className={styles.carryTag}>负{entry.carryUnits}</span>
                                )}
                              </span>
                            </span>
                          </button>
                          <div className={styles.quickOps}>
                            <button
                              type="button"
                              className={styles.quickBtn}
                              data-dir="store"
                              disabled={rowBlocked}
                              title={
                                entry.blockedReason ??
                                storeBlocked ??
                                (canBatch ? `存入 1 件到${group.name}` : `存入${group.name}`)
                              }
                              onClick={() => {
                                setActivePane("carried");
                                setPickedCarried({ key: entry.key, fallbackIndex: index });
                                void handleStore(entry, index, 1);
                              }}
                            >
                              存→
                            </button>
                            {canBatch && (
                              <button
                                type="button"
                                className={styles.quickBtnAll}
                                data-dir="store"
                                disabled={rowBlocked}
                                title={
                                  entry.blockedReason ??
                                  storeBlocked ??
                                  `将全部 ${entry.count} 件存入${group.name}`
                                }
                                onClick={() => {
                                  setActivePane("carried");
                                  setPickedCarried({ key: entry.key, fallbackIndex: index });
                                  void handleStore(entry, index, entry.count);
                                }}
                              >
                                全
                              </button>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {/* 右列：当前存放点物品（点击行选中，左侧快操按钮或双击直接取回） */}
            <section
              className={styles.pane}
              data-active={effectivePane === "stored" || undefined}
              aria-label={`${group.name}里的物品`}
            >
              <header className={styles.paneHead}>
                <span className={styles.paneTitle}>{group.name}</span>
                <span className={styles.paneMeta}>
                  {visibleStored.length !== groupItems.length
                    ? `${visibleStored.length}/${groupItems.length} 项`
                    : `${totalStoredUnits} 件`}
                </span>
              </header>

              {visibleStored.length === 0 ? (
                <div className={styles.paneEmpty}>
                  <span>
                    {groupItems.length === 0
                      ? `「${group.name}」目前为空，点左侧「存→」或双击随身物品即可放入。`
                      : "存放点无匹配项。"}
                  </span>
                </div>
              ) : (
                <ul ref={storedListRef} className={styles.paneList}>
                  {visibleStored.map((entry, index) => {
                    const entryArt = itemArtOf(entry.baseId ?? entry.id);
                    const isSelected =
                      effectivePane === "stored" && selectedStored?.id === entry.id;
                    const rowBlocked = Boolean(takeBlocked);
                    const canBatch = entry.count > 1;
                    return (
                      <li key={entry.id} className={styles.transferItem}>
                        <div
                          className={styles.transferRow}
                          data-selected={isSelected || undefined}
                          data-rarity={entry.rarity ?? undefined}
                          data-iconic={entry.iconic || undefined}
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
                          {entry.rarity && (
                            <NineSlice
                              id="cyber.cellRarity"
                              tint="var(--rarity)"
                              slice={0}
                              className={inv.itemRarityBar}
                            />
                          )}
                          <div className={styles.quickOps}>
                            <button
                              type="button"
                              className={styles.quickBtn}
                              data-dir="take"
                              disabled={rowBlocked}
                              title={
                                takeBlocked ?? (canBatch ? "取回 1 件到随身背包" : "取回到随身背包")
                              }
                              onClick={() => {
                                setActivePane("stored");
                                setPickedStored({ id: entry.id, fallbackIndex: index });
                                void handleTake(entry, index, 1);
                              }}
                            >
                              ←取
                            </button>
                            {canBatch && (
                              <button
                                type="button"
                                className={styles.quickBtnAll}
                                data-dir="take"
                                disabled={rowBlocked}
                                title={takeBlocked ?? `将全部 ${entry.count} 件取回到随身背包`}
                                onClick={() => {
                                  setActivePane("stored");
                                  setPickedStored({ id: entry.id, fallbackIndex: index });
                                  void handleTake(entry, index, entry.count);
                                }}
                              >
                                全
                              </button>
                            )}
                          </div>
                          <button
                            type="button"
                            data-storage-index={index}
                            className={styles.transferSelect}
                            aria-pressed={isSelected}
                            onClick={() => {
                              setActivePane("stored");
                              setPickedStored({ id: entry.id, fallbackIndex: index });
                            }}
                            onDoubleClick={() => {
                              setActivePane("stored");
                              setPickedStored({ id: entry.id, fallbackIndex: index });
                              if (!rowBlocked) void handleTake(entry, index, 1);
                            }}
                          >
                            <span className={styles.miniThumb} aria-hidden>
                              {entryArt ? (
                                <Asset id={entryArt} className={inv.itemArt} />
                              ) : (
                                <Asset id="notify.inventory" tint="var(--cp-cyan)" height={15} />
                              )}
                            </span>
                            <span className={styles.transferInfo}>
                              <span className={styles.transferNameLine}>
                                <strong className={styles.transferName}>{entry.name}</strong>
                                {entry.count > 1 && (
                                  <b className={styles.transferCount}>×{entry.count}</b>
                                )}
                              </span>
                              <span className={styles.transferSub}>
                                <span>{entry.subLabel}</span>
                                {entry.rarityLabel && (
                                  <span className={inv.itemRarityWord}>{entry.rarityLabel}</span>
                                )}
                                {entry.carryUnits > 0 && (
                                  <span className={styles.carryTag}>负{entry.carryUnits}</span>
                                )}
                              </span>
                            </span>
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>

          {/* 底部焦点详情与快捷操作条 */}
          {focusedItem ? (
            <footer
              className={styles.focusBar}
              data-rarity={focusedItem.row.rarity ?? undefined}
              data-iconic={focusedItem.row.iconic || undefined}
            >
              <CellFrame />
              <span className={styles.focusThumb} aria-hidden>
                {focusedItem.art ? (
                  <Asset id={focusedItem.art} className={inv.itemArt} />
                ) : (
                  <Asset id="notify.inventory" tint="var(--cp-cyan)" height={20} />
                )}
              </span>
              <div className={styles.focusInfo}>
                <div className={styles.focusTitleRow}>
                  <span className={styles.focusSideTag} data-side={focusedItem.side}>
                    {focusedItem.side === "carried" ? "随身" : group.name}
                  </span>
                  <strong className={styles.focusName}>{focusedItem.row.name}</strong>
                  {focusedItem.row.count > 1 && (
                    <b className={styles.transferCount}>×{focusedItem.row.count}</b>
                  )}
                  <span className={styles.focusMeta}>
                    {focusedItem.row.subLabel}
                    {focusedItem.row.rarityLabel ? ` · ${focusedItem.row.rarityLabel}` : ""}
                    {focusedItem.row.carryUnits > 0 ? ` · 负担 ${focusedItem.row.carryUnits}` : ""}
                    {focusedItem.row.remaining !== null && focusedItem.row.charges !== null
                      ? ` · ${focusedItem.row.remaining}/${focusedItem.row.charges} 次`
                      : ""}
                  </span>
                </div>
                <p className={styles.focusDesc}>
                  {focusedItem.blocked ??
                    (focusedItem.row.ability ||
                      "双击或按 Enter 存取 1 件，Shift+Enter 全部存取，←/→ 切栏。")}
                </p>
              </div>
              <div className={styles.focusActions}>
                {focusedItem.side === "carried" ? (
                  <>
                    <Button
                      small
                      primary={!focusedItem.blocked}
                      disabled={Boolean(focusedItem.blocked)}
                      reason={focusedItem.blocked}
                      onClick={() => void handleStore(focusedItem.row, selectedCarriedIndex, 1)}
                    >
                      {busy
                        ? "处理中…"
                        : focusedItem.batchCount > 1
                          ? "存入 1 件"
                          : `存入${group.name}`}
                    </Button>
                    {focusedItem.batchCount > 1 && (
                      <Button
                        small
                        disabled={Boolean(focusedItem.blocked)}
                        reason={focusedItem.blocked}
                        onClick={() =>
                          void handleStore(
                            focusedItem.row,
                            selectedCarriedIndex,
                            focusedItem.batchCount,
                          )
                        }
                      >
                        全部存入 ({focusedItem.batchCount})
                      </Button>
                    )}
                  </>
                ) : (
                  <>
                    <Button
                      small
                      primary={!focusedItem.blocked}
                      disabled={Boolean(focusedItem.blocked)}
                      reason={focusedItem.blocked}
                      onClick={() => void handleTake(focusedItem.row, selectedStoredIndex, 1)}
                    >
                      {busy ? "处理中…" : focusedItem.batchCount > 1 ? "取回 1 件" : "取回随身"}
                    </Button>
                    {focusedItem.batchCount > 1 && (
                      <Button
                        small
                        disabled={Boolean(focusedItem.blocked)}
                        reason={focusedItem.blocked}
                        onClick={() =>
                          void handleTake(
                            focusedItem.row,
                            selectedStoredIndex,
                            focusedItem.batchCount,
                          )
                        }
                      >
                        全部取回 ({focusedItem.batchCount})
                      </Button>
                    )}
                  </>
                )}
              </div>
            </footer>
          ) : (
            (search || filter !== "all") && (
              <div className={styles.focusReset}>
                <span>没有符合当前筛选条件的物品。</span>
                <ActionButton
                  onClick={() => {
                    setFilter("all");
                    setSearch("");
                  }}
                >
                  重置筛选
                </ActionButton>
              </div>
            )
          )}
        </>
      ) : !selectedStored ? (
        <div className={inv.emptyBox}>
          <CellFrame />
          <span>
            {groupItems.length === 0
              ? `「${group.name}」里还没有存放物品。`
              : "没有符合当前筛选条件的存放物品。"}
          </span>
          {(search || filter !== "all") && (
            <ActionButton
              onClick={() => {
                setFilter("all");
                setSearch("");
              }}
            >
              重置筛选
            </ActionButton>
          )}
        </div>
      ) : (
        /* 远端/只读存放点：保留高信息密度的左列表 + 右详情卡 */
        <div className={inv.browser}>
          <ul ref={storedListRef} className={inv.itemList} aria-label="查看远端存放物品">
            {visibleStored.map((entry, index) => {
              const entryArt = itemArtOf(entry.baseId ?? entry.id);
              const isSelected = entry.id === selectedStored.id;
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    data-storage-index={index}
                    className={inv.itemRow}
                    aria-pressed={isSelected}
                    data-rarity={entry.rarity ?? undefined}
                    data-iconic={entry.iconic || undefined}
                    onClick={() => setPickedStored({ id: entry.id, fallbackIndex: index })}
                  >
                    <NineSlice
                      id="map.filterCellBg"
                      tint="var(--item-fill, rgb(13 15 24 / 82%))"
                      slice={CELL_SLICE}
                    />
                    <NineSlice id="map.filterCellFg" tint="var(--item-line)" slice={CELL_SLICE} />
                    {entry.rarity && (
                      <NineSlice
                        id="cyber.cellRarity"
                        tint="var(--rarity)"
                        slice={0}
                        className={inv.itemRarityBar}
                      />
                    )}
                    <span className={inv.itemThumb} aria-hidden>
                      <span
                        className={inv.itemThumbGrid}
                        style={{ backgroundImage: cssUrl("fx.grid") }}
                      />
                      {entryArt ? (
                        <Asset id={entryArt} className={inv.itemArt} />
                      ) : (
                        <Asset id="notify.inventory" tint="var(--cp-cyan)" height={18} />
                      )}
                    </span>
                    <span className={inv.itemInfo}>
                      <span className={inv.itemTopLine}>
                        <strong className={inv.itemName}>{entry.name}</strong>
                      </span>
                      <span className={inv.itemSubLine}>
                        <span className={inv.itemSubText}>
                          {entry.subLabel}
                          {entry.rarityLabel && (
                            <>
                              {" · "}
                              <span className={inv.itemRarityWord}>{entry.rarityLabel}</span>
                            </>
                          )}
                          {entry.remaining !== null && entry.charges !== null
                            ? ` · ${entry.remaining}/${entry.charges} 次`
                            : ""}
                        </span>
                      </span>
                    </span>
                    <span className={inv.itemMeta}>
                      {entry.count > 1 && <b className={inv.itemCount}>×{entry.count}</b>}
                      {entry.carryUnits > 0 && (
                        <span className={inv.itemCarryTag}>负担 {entry.carryUnits}</span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <article
            key={selectedStored.id}
            className={inv.detailCard}
            data-rarity={selectedStored.rarity ?? undefined}
            data-iconic={selectedStored.iconic || undefined}
            aria-label="存放物品详情"
          >
            <CellFrame />
            <span
              className={inv.detailGrid}
              style={{ backgroundImage: cssUrl("fx.grid") }}
              aria-hidden
            />
            {selectedStored.rarity && (
              <NineSlice
                id="cyber.cellRarity"
                tint="var(--rarity)"
                slice={0}
                className={inv.detailRarityBar}
              />
            )}

            <header className={inv.detailHead}>
              <div className={inv.detailTitleRow}>
                <strong className={inv.detailTitle}>{selectedStored.name}</strong>
                {selectedStored.count > 1 && (
                  <b className={inv.detailCount}>×{selectedStored.count}</b>
                )}
              </div>
              <div className={inv.detailTags}>
                {selectedStored.rarityLabel && (
                  <span className={inv.pillRarity}>
                    <NineSlice
                      id="cyber.gaugeLabel"
                      tint="var(--rarity, var(--cp-cyan))"
                      slice={4}
                    />
                    <span className={inv.pillText}>{selectedStored.rarityLabel}</span>
                  </span>
                )}
                <span className={inv.pill}>
                  <NineSlice id="cyber.gaugeLabel" tint="rgb(94 246 255 / 16%)" slice={4} />
                  <span className={inv.pillText}>{selectedStored.subLabel}</span>
                </span>
                {selectedStored.carryUnits > 0 && (
                  <span className={inv.pill}>
                    <NineSlice id="cyber.gaugeLabel" tint="rgb(148 163 184 / 16%)" slice={4} />
                    <span className={inv.pillText}>负担 {selectedStored.carryUnits}</span>
                  </span>
                )}
                {selectedStored.remaining !== null && selectedStored.charges !== null && (
                  <span className={inv.pill}>
                    <NineSlice id="cyber.gaugeLabel" tint="rgb(94 246 255 / 16%)" slice={4} />
                    <span className={inv.pillText}>
                      剩余 {selectedStored.remaining}/{selectedStored.charges} 次
                    </span>
                  </span>
                )}
              </div>
            </header>

            <div className={inv.detailScroll}>
              {readOnlyArt && (
                <div className={inv.showcase} aria-hidden>
                  <CellFrame />
                  <span
                    className={inv.showcaseGrid}
                    style={{ backgroundImage: cssUrl("fx.grid") }}
                  />
                  {selectedStored.rarityLabel && (
                    <span className={inv.showcaseCornerLeft}>{selectedStored.rarityLabel}</span>
                  )}
                  {selectedStored.carryUnits > 0 && (
                    <span className={inv.showcaseCornerRight}>
                      负担 {selectedStored.carryUnits}
                    </span>
                  )}
                  <Asset id={readOnlyArt} className={inv.showcaseArt} />
                </div>
              )}
              {selectedStored.ability && (
                <div className={inv.detailCopy}>
                  <p className={inv.detailDesc}>{selectedStored.ability}</p>
                </div>
              )}
            </div>

            <footer className={inv.detailFooter}>
              <p className={inv.actionHint}>
                {group.blockedReason ?? "当前不在该存放点附近，仅支持远程查看清单。"}
              </p>
            </footer>
          </article>
        </div>
      )}
    </section>
  );
}
