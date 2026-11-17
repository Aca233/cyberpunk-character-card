import { useState } from "react";
import { ActionButton } from "../../ui/ActionButton";
import { PinTabs } from "./Corners";
import cornerStyles from "./corners.module.css";
import styles from "./story.module.css";
import type { View } from "./view";

/**
 * 物品栏底部的可折叠「储物」区：仅在当前安全屋内展示存放箱。
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
  const [picked, setPicked] = useState("");
  const homes = view.safehouse.homes.filter((h) => h.here);
  const home = homes.find((h) => h.id === picked) ?? homes[0];
  if (!home) return null;

  const summaryParts = homes.map((h) => {
    const total = h.items.reduce((sum, i) => sum + i.count, 0);
    return `${h.name}存放箱 ${total}`;
  });

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
          {homes.length > 1 && (
            <PinTabs
              tabs={homes.map((h) => [h.id, `${h.name}的存放箱`, h.items.length] as const)}
              value={home.id}
              onChange={setPicked}
            />
          )}
          <StashBody
            view={view}
            box={{
              id: home.id,
              name: `${home.name}的存放箱`,
              items: home.items,
              cap: null,
              canStore: true,
            }}
            onMove={onMove}
          />
        </div>
      )}
    </section>
  );
}

export interface StashBox {
  readonly id: string;
  readonly name: string;
  readonly items: readonly { readonly id: string; readonly name: string; readonly count: number }[];
  readonly cap: number | null;
  readonly canStore: boolean;
}

/** 单个存放箱或后备箱的明细，容器选择由所在页面管理。 */
export function StashBody({
  view,
  box,
  onMove,
  disabledReason,
}: {
  readonly view: View;
  readonly box: StashBox;
  readonly onMove?: ((action: "store" | "take", item: string, where: string) => void) | undefined;
  readonly disabledReason?: string | undefined;
}) {
  // 玩家投影已把随身武器与未安装、随身携带且未报废的义体合并到背包。
  const backpack = Object.entries(view.inventory.backpack);
  const itemName = (id: string) => view.names.items[id] ?? id;
  const full = box.cap !== null && box.items.length >= box.cap;

  return (
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
                  <ActionButton
                    disabled={Boolean(disabledReason)}
                    title={disabledReason}
                    onClick={() => onMove("take", i.id, box.id)}
                  >
                    拿出
                  </ActionButton>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {box.canStore && (
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
                      disabled={
                        Boolean(disabledReason) || (full && !box.items.some((i) => i.id === id))
                      }
                      title={disabledReason}
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
      )}
    </div>
  );
}
