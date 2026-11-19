import { useState } from "react";
import { Asset, cssUrl, NineSlice } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { CellFrame } from "../../ui/FrameBox";
import { itemArtOf } from "./art";
import styles from "./inventory-storage.module.css";
import story from "./story.module.css";
import type { View } from "./view";

export type PlaceInventoryItem = (
  action: "leave" | "take",
  item: string,
  where: string,
  source?: "backpack" | "worn" | "quick",
) => Promise<void>;

type StorageGroup = View["safehouse"]["storage"][number];

/** 只操作已经由后端判定可达的自有存放点；远处和人物交接可查看。 */
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
  readonly onTake: ((item: string, target: string) => void) | undefined;
  readonly busy: boolean;
  readonly disabledReason: string | undefined;
}) {
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const group =
    groups.find((entry) => entry.key === selectedKey) ??
    groups.find((entry) => entry.canTake || entry.canStore) ??
    groups[0];
  const item = group?.items.find((entry) => entry.id === selectedItem) ?? group?.items[0];

  if (!group) {
    return (
      <div className={story.inventoryEmpty}>
        <CellFrame />
        还没有已登记的存放位置。获得住处或车辆后，可在现场存取物品。
      </div>
    );
  }

  const takeBlocked =
    disabledReason ||
    (busy
      ? "正在处理物品，请稍候"
      : !group.canTake
        ? (group.blockedReason ?? "当前只能查看此处物品")
        : !onTake
          ? "当前无法取回物品"
          : undefined);
  const art = item ? itemArtOf(item.baseId ?? item.id) : undefined;

  return (
    <section className={styles.storageRoot} aria-label="存放物品">
      <label className={styles.storagePicker}>
        <span>存放位置</span>
        <select
          className={styles.storageSelect}
          value={group.key}
          onChange={(event) => {
            onSelect(event.target.value);
            setSelectedItem(null);
          }}
        >
          {groups.map((entry) => (
            <option key={entry.key} value={entry.key}>
              {entry.name} · {entry.locationName}
            </option>
          ))}
        </select>
      </label>
      <div className={story.loadoutBar}>
        <strong className={story.loadoutTitle}>{group.name}</strong>
        <small className={styles.storageHelp}>
          {group.locationName} · {group.items.reduce((sum, entry) => sum + entry.count, 0)} 件
        </small>
      </div>
      {group.blockedReason && (
        <p className={styles.storageHelp} role="status">
          {group.blockedReason}
        </p>
      )}
      {!item ? (
        <div className={story.inventoryEmpty}>
          <CellFrame />
          这里还没有存放物品。
          {group.canStore && "在「随身」页选中物品即可存放。"}
        </div>
      ) : (
        <div className={story.inventoryBrowser}>
          <ul className={story.inventoryGrid} aria-label="选择存放物品">
            {group.items.map((entry) => {
              const entryArt = itemArtOf(entry.baseId ?? entry.id);
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    className={story.gridItem}
                    aria-pressed={entry.id === item.id}
                    data-rarity={entry.rarity ?? undefined}
                    data-iconic={entry.iconic || undefined}
                    onClick={() => setSelectedItem(entry.id)}
                  >
                    <NineSlice
                      id="map.filterCellBg"
                      tint="var(--item-fill, rgb(14 14 23 / 80%))"
                      slice={[20, 30, 30, 20]}
                    />
                    <NineSlice
                      id="map.filterCellFg"
                      tint="var(--item-line)"
                      slice={[20, 30, 30, 20]}
                    />
                    <span className={story.gridThumb} aria-hidden>
                      <Asset
                        id={entryArt ?? "notify.inventory"}
                        className={story.weaponArt}
                        height={24}
                      />
                    </span>
                    <span className={story.gridInfo}>
                      <strong className={story.gridName}>{entry.name}</strong>
                      <small className={story.gridSub}>
                        {entry.subLabel}
                        {entry.rarityLabel ? ` · ${entry.rarityLabel}` : ""}
                        {entry.remaining !== null && entry.charges !== null
                          ? ` · ${entry.remaining}/${entry.charges} 次`
                          : ""}
                      </small>
                    </span>
                    {entry.count > 1 && <b className={story.gridCount}>×{entry.count}</b>}
                  </button>
                </li>
              );
            })}
          </ul>
          <article
            className={story.inventoryDetail}
            data-rarity={item.rarity ?? undefined}
            data-iconic={item.iconic || undefined}
            aria-label="存放物品详情"
          >
            <CellFrame />
            <span
              className={story.detailGrid}
              style={{ backgroundImage: cssUrl("fx.grid") }}
              aria-hidden
            />
            <header className={story.detailHead}>
              <strong className={story.detailTitle}>{item.name}</strong>
              <small className={styles.storageHelp}>
                {item.subLabel} · 存放 {item.count} 件
                {item.rarityLabel ? ` · ${item.rarityLabel}` : ""}
                {item.remaining !== null && item.charges !== null
                  ? ` · 剩余 ${item.remaining}/${item.charges} 次`
                  : ""}
              </small>
            </header>
            {art && (
              <div className={story.detailShowcase} aria-hidden>
                <CellFrame />
                <Asset id={art} className={story.detailArt} />
              </div>
            )}
            {item.ability && <p className={story.detailDesc}>{item.ability}</p>}
            <div className={story.detailActions}>
              <div className={story.detailActionGroup}>
                <Button
                  small
                  primary={!takeBlocked}
                  disabled={Boolean(takeBlocked)}
                  reason={takeBlocked}
                  onClick={() => {
                    if (!takeBlocked) onTake?.(item.id, group.target);
                  }}
                >
                  {busy ? "正在处理…" : item.count > 1 ? "取回 1 件" : "取回随身"}
                </Button>
                <small className={story.detailHint}>
                  {takeBlocked ?? "取回后放入随身背包，不自动切换当前武器。"}
                </small>
              </div>
            </div>
          </article>
        </div>
      )}
    </section>
  );
}
