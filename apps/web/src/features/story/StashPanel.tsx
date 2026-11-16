import { useState } from "react";
import { ActionButton } from "../../ui/ActionButton";
import { PinTabs } from "./Corners";
import cornerStyles from "./corners.module.css";
import styles from "./story.module.css";
import type { View } from "./view";

/** 当前位置能打开存放箱（住在当前安全屋）或名下有可用后备箱 */
export function hasStorageAccess(view: View): boolean {
  return view.safehouse.homes.some((h) => h.here) || view.safehouse.trunks.length > 0;
}

/**
 * 物品栏底部的可折叠「储物」区：安全屋存放箱（仅在对应安全屋内可存取）与名下车辆后备箱。
 * 默认收起为一行摘要，点开即可原地存/取背包物品（含全部随身武器）；没有可用储物空间时完全不渲染。
 */
export function StashSection({
  view,
  onMove,
}: {
  readonly view: View;
  /** 忙、战斗中或已结局时不传，隐藏操作按钮 */
  readonly onMove?: ((action: "store" | "take", item: string, where: string) => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
  const { homes, trunks } = view.safehouse;
  const hereHomes = homes.filter((h) => h.here);
  if (hereHomes.length === 0 && trunks.length === 0) return null;

  const summaryParts = [
    ...hereHomes.map((h) => {
      const total = h.items.reduce((sum, i) => sum + i.count, 0);
      return `${h.name}存放箱 ${total}`;
    }),
    ...trunks.map((t) => `${t.name} ${t.items.length}/${t.cap}`),
  ];

  return (
    <section className={styles.stashSection} aria-label="储物">
      <button
        type="button"
        className={styles.stashToggle}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.stashSummary}>储物 · {summaryParts.join(" · ")}</span>
        <span className={styles.stashCaret}>{open ? "收起 ▴" : "展开 ▾"}</span>
      </button>
      {open && (
        <div className={styles.stashBody}>
          <StashBody view={view} onMove={onMove} />
        </div>
      )}
    </section>
  );
}

/** 存放箱与车辆后备箱的双向存取明细 */
export function StashBody({
  view,
  onMove,
}: {
  readonly view: View;
  readonly onMove?: ((action: "store" | "take", item: string, where: string) => void) | undefined;
}) {
  const { homes, trunks } = view.safehouse;
  const boxes = [
    ...homes
      .filter((h) => h.here)
      .map((h) => ({
        id: h.id,
        name: `${h.name}的存放箱`,
        items: h.items,
        cap: null as number | null,
      })),
    ...trunks.map((t) => ({ id: t.id, name: t.name, items: t.items, cap: t.cap })),
  ];
  const [picked, setPicked] = useState(boxes[0]?.id ?? "");
  const box = boxes.find((b) => b.id === picked) ?? boxes[0];
  if (!box) return null;
  const backpack = Object.entries(view.inventory.backpack);
  const itemName = (id: string) => view.names.items[id] ?? id;
  const full = box.cap !== null && box.items.length >= box.cap;

  return (
    <>
      {boxes.length > 1 && (
        <PinTabs
          tabs={boxes.map((b) => [b.id, b.name, b.items.length] as const)}
          value={box.id}
          onChange={setPicked}
        />
      )}
      <div className={styles.stashColumns}>
        <section className={cornerStyles.peekGroup}>
          <h4>
            {box.name}
            {box.cap !== null && ` ${box.items.length}/${box.cap}`}
          </h4>
          {box.items.length === 0 ? (
            <p className={cornerStyles.peekNote}>空的</p>
          ) : (
            <ul className={styles.stashList}>
              {box.items.map((i) => (
                <li key={i.id} className={styles.stashRow}>
                  <span>
                    {i.name}
                    {i.count > 1 && ` ×${i.count}`}
                  </span>
                  {onMove && (
                    <ActionButton onClick={() => onMove("take", i.id, box.id)}>拿出</ActionButton>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className={cornerStyles.peekGroup}>
          <h4>随身背包</h4>
          {backpack.length === 0 ? (
            <p className={cornerStyles.peekNote}>空的</p>
          ) : (
            <ul className={styles.stashList}>
              {backpack.map(([id, count]) => (
                <li key={id} className={styles.stashRow}>
                  <span>
                    {itemName(id)}
                    {count > 1 && ` ×${count}`}
                  </span>
                  {onMove && (
                    <ActionButton
                      disabled={full && !box.items.some((i) => i.id === id)}
                      onClick={() => onMove("store", id, box.id)}
                    >
                      存入
                    </ActionButton>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
