import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActionButton } from "../../ui/ActionButton";
import { Asset, cssUrl, NineSlice } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { CellFrame, FrameBox } from "../../ui/FrameBox";
import { useLayer } from "../../ui/layers";
import { itemArtOf } from "./art";
import inv from "./inventory.module.css";
import styles from "./inventory-storage.module.css";
import type { View } from "./view";

export type PlaceInventoryItem = (
  action: "leave" | "take",
  item: string,
  where: string,
  source?: "backpack" | "worn" | "quick",
) => Promise<void>;

type StorageGroup = View["safehouse"]["storage"][number];
type StorageFilter = "all" | "weapon" | "clothing" | "mod" | "usable" | "misc";

const CELL_SLICE = [20, 30, 30, 20] as const;

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.closest("input, textarea, select") !== null)
  );
}

/** 存放物品独立视图：赛博位置切换芯片 + 分类/搜索 + 全高双栏独立滚动 + 双击与键盘快操 */
export function InventoryStorage({
  groups,
  selectedKey,
  onSelect,
  onTake,
  busy,
  disabledReason,
}: {
  readonly groups: readonly StorageGroup[];
  readonly selectedKey: string | null;
  readonly onSelect: (key: string) => void;
  readonly onTake: ((item: string, target: string) => Promise<void> | void) | undefined;
  readonly busy: boolean;
  readonly disabledReason: string | undefined;
}) {
  const [filter, setFilter] = useState<StorageFilter>("all");
  const [search, setSearch] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [picked, setPicked] = useState<{ id: string; fallbackIndex?: number } | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const receiptTimer = useRef<number | undefined>(undefined);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

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

  const groupItems = group?.items ?? [];

  const filterCounts = useMemo(() => {
    const counts: Record<StorageFilter, number> = {
      all: groupItems.length,
      weapon: 0,
      clothing: 0,
      mod: 0,
      usable: 0,
      misc: 0,
    };
    for (const item of groupItems) {
      if (item.kind === "weapon") counts.weapon += 1;
      else if (item.kind === "clothing") counts.clothing += 1;
      else if (item.kind === "mod") counts.mod += 1;
      else if (item.kind === "healing" || item.kind === "grenade" || item.kind === "consumable") {
        counts.usable += 1;
      } else {
        counts.misc += 1;
      }
    }
    return counts;
  }, [groupItems]);

  const visibleItems = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return groupItems.filter((item) => {
      const matchesFilter =
        filter === "all" ||
        (filter === "usable"
          ? item.kind === "healing" || item.kind === "grenade" || item.kind === "consumable"
          : item.kind === filter);
      if (!matchesFilter) return false;
      if (!query) return true;
      return `${item.name} ${item.subLabel} ${item.rarityLabel ?? ""} ${item.ability ?? ""}`
        .toLocaleLowerCase()
        .includes(query);
    });
  }, [filter, groupItems, search]);

  const selectedIndex = useMemo(() => {
    if (visibleItems.length === 0) return -1;
    if (picked?.id) {
      const exact = visibleItems.findIndex((entry) => entry.id === picked.id);
      if (exact >= 0) return exact;
    }
    if (picked?.fallbackIndex !== undefined) {
      return Math.min(picked.fallbackIndex, visibleItems.length - 1);
    }
    return 0;
  }, [picked, visibleItems]);

  const item = selectedIndex >= 0 ? visibleItems[selectedIndex] : undefined;

  const takeBlocked = !group
    ? "没有可用存放点"
    : disabledReason ||
      (busy
        ? "正在处理物品，请稍候"
        : !group.canTake
          ? (group.blockedReason ?? "当前只能查看此处物品")
          : !onTake
            ? "当前无法取回物品"
            : undefined);

  const handleTake = useCallback(
    async (entry: StorageGroup["items"][number], index: number) => {
      if (!group || takeBlocked || !onTake) return;
      setActionError("");
      if (entry.count <= 1) {
        setPicked({ id: entry.id, fallbackIndex: index });
      }
      try {
        await onTake(entry.id, group.target);
        showReceipt(`已从${group.name}取回「${entry.name}」`);
      } catch (error) {
        setActionError(error instanceof Error ? error.message : "取回失败，请重试");
      }
    },
    [group, onTake, showReceipt, takeBlocked],
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

  // 键盘导航：↑/↓ 选物品，/ 聚焦搜索，Enter 取回
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
        if (visibleItems.length === 0) return;
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        const cur = Math.max(selectedIndex, 0);
        const nextIdx = (cur + delta + visibleItems.length) % visibleItems.length;
        const nextItem = visibleItems[nextIdx];
        if (nextItem) {
          setPicked({ id: nextItem.id, fallbackIndex: nextIdx });
          const row = listRef.current?.querySelector<HTMLElement>(
            `[data-storage-index="${nextIdx}"]`,
          );
          row?.scrollIntoView({ block: "nearest" });
        }
        return;
      }

      if (event.key === "Enter" && !event.repeat && item && !takeBlocked) {
        const activeEl = document.activeElement;
        if (
          activeEl instanceof HTMLElement &&
          activeEl.closest("button") &&
          !activeEl.hasAttribute("data-storage-index")
        ) {
          return;
        }
        event.preventDefault();
        void handleTake(item, selectedIndex);
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [handleTake, item, selectedIndex, takeBlocked, visibleItems]);

  if (!group) {
    return (
      <div className={inv.emptyBox}>
        <CellFrame />
        <span>还没有已登记的存放位置。获得住处或车辆后，可在现场存取物品。</span>
      </div>
    );
  }

  const totalUnits = group.items.reduce((sum, entry) => sum + entry.count, 0);
  const art = item ? itemArtOf(item.baseId ?? item.id) : undefined;
  const filterTabs: readonly (readonly [StorageFilter, string, number])[] = [
    ["all", "全部", filterCounts.all],
    ["weapon", "武器", filterCounts.weapon],
    ["usable", "可用", filterCounts.usable],
    ["clothing", "服装", filterCounts.clothing],
    ["mod", "改装件", filterCounts.mod],
    ["misc", "杂物", filterCounts.misc],
  ];

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

      {/* 赛博位置芯片切换条（替换原生 select） */}
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
              title={`${entry.name} · ${entry.locationName}${reachable ? "（就在附近，可直接存取）" : "（远端只读）"}`}
              onClick={() => {
                onSelect(entry.key);
                setPicked(null);
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
              <span className={styles.locationChipName}>{entry.name}</span>
              <span className={styles.locationChipSub}>{entry.locationName}</span>
              <b className={styles.locationChipCount}>{entryCount}</b>
            </button>
          );
        })}
      </nav>

      {/* 当前存放点状态摘要 */}
      <div className={styles.groupSummary} data-locked={!group.canTake || undefined}>
        <span className={styles.groupSummaryTitle}>
          {group.name} · {group.locationName}
        </span>
        <span className={styles.groupSummaryMeta}>
          共 {totalUnits} 件 · {group.canTake ? "现场可达，可存取" : "仅可查看"}
        </span>
        {group.blockedReason && (
          <p className={styles.groupBlocked} role="status">
            {group.blockedReason}
          </p>
        )}
      </div>

      {/* 筛选 + 搜索 */}
      {groupItems.length > 0 && (
        <div className={inv.toolbar}>
          <nav className={inv.filterRow} aria-label="存放物品分类">
            {filterTabs.map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                className={inv.filterChip}
                aria-pressed={filter === key}
                data-zero={count === 0 && key !== "all" ? "" : undefined}
                onClick={() => {
                  setFilter(key);
                  setPicked(null);
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
                placeholder="搜存放物品…"
                aria-label="搜索存放物品"
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

      {!item ? (
        <div className={inv.emptyBox}>
          <CellFrame />
          <span>
            {groupItems.length === 0
              ? `「${group.name}」里还没有存放物品。${group.canStore ? "在「随身」页选中物品即可存放。" : ""}`
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
        <div className={inv.browser}>
          <ul ref={listRef} className={inv.itemList} aria-label="选择存放物品">
            {visibleItems.map((entry, index) => {
              const entryArt = itemArtOf(entry.baseId ?? entry.id);
              const isSelected = entry.id === item.id;
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    data-storage-index={index}
                    className={inv.itemRow}
                    aria-pressed={isSelected}
                    data-rarity={entry.rarity ?? undefined}
                    data-iconic={entry.iconic || undefined}
                    onClick={() => setPicked({ id: entry.id, fallbackIndex: index })}
                    onDoubleClick={() => {
                      setPicked({ id: entry.id, fallbackIndex: index });
                      if (!takeBlocked) void handleTake(entry, index);
                    }}
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
            key={item.id}
            className={inv.detailCard}
            data-rarity={item.rarity ?? undefined}
            data-iconic={item.iconic || undefined}
            aria-label="存放物品详情"
          >
            <CellFrame />
            <span
              className={inv.detailGrid}
              style={{ backgroundImage: cssUrl("fx.grid") }}
              aria-hidden
            />
            {item.rarity && (
              <NineSlice
                id="cyber.cellRarity"
                tint="var(--rarity)"
                slice={0}
                className={inv.detailRarityBar}
              />
            )}

            <header className={inv.detailHead}>
              <div className={inv.detailTitleRow}>
                <strong className={inv.detailTitle}>{item.name}</strong>
                {item.count > 1 && <b className={inv.detailCount}>×{item.count}</b>}
              </div>
              <div className={inv.detailTags}>
                {item.rarityLabel && (
                  <span className={inv.pillRarity}>
                    <NineSlice
                      id="cyber.gaugeLabel"
                      tint="var(--rarity, var(--cp-cyan))"
                      slice={4}
                    />
                    <span className={inv.pillText}>{item.rarityLabel}</span>
                  </span>
                )}
                <span className={inv.pill}>
                  <NineSlice id="cyber.gaugeLabel" tint="rgb(94 246 255 / 16%)" slice={4} />
                  <span className={inv.pillText}>{item.subLabel}</span>
                </span>
                {item.carryUnits > 0 && (
                  <span className={inv.pill}>
                    <NineSlice id="cyber.gaugeLabel" tint="rgb(148 163 184 / 16%)" slice={4} />
                    <span className={inv.pillText}>负担 {item.carryUnits}</span>
                  </span>
                )}
                {item.remaining !== null && item.charges !== null && (
                  <span className={inv.pill}>
                    <NineSlice id="cyber.gaugeLabel" tint="rgb(94 246 255 / 16%)" slice={4} />
                    <span className={inv.pillText}>
                      剩余 {item.remaining}/{item.charges} 次
                    </span>
                  </span>
                )}
              </div>
            </header>

            <div className={inv.detailScroll}>
              {art && (
                <div className={inv.showcase} aria-hidden>
                  <CellFrame />
                  <span
                    className={inv.showcaseGrid}
                    style={{ backgroundImage: cssUrl("fx.grid") }}
                  />
                  {item.rarityLabel && (
                    <span className={inv.showcaseCornerLeft}>{item.rarityLabel}</span>
                  )}
                  {item.carryUnits > 0 && (
                    <span className={inv.showcaseCornerRight}>负担 {item.carryUnits}</span>
                  )}
                  <Asset id={art} className={inv.showcaseArt} />
                </div>
              )}
              {item.ability && (
                <div className={inv.detailCopy}>
                  <p className={inv.detailDesc}>{item.ability}</p>
                </div>
              )}
            </div>

            <footer className={inv.detailFooter}>
              <div className={inv.actionRow}>
                <Button
                  small
                  primary={!takeBlocked}
                  disabled={Boolean(takeBlocked)}
                  reason={takeBlocked}
                  onClick={() => void handleTake(item, selectedIndex)}
                >
                  {busy ? "正在处理…" : item.count > 1 ? "取回 1 件" : "取回随身"}
                </Button>
              </div>
              <p className={inv.actionHint}>
                {takeBlocked ?? "取回后放入随身背包（也可双击列表项或按 Enter 快速取回）。"}
              </p>
            </footer>
          </article>
        </div>
      )}
    </section>
  );
}
