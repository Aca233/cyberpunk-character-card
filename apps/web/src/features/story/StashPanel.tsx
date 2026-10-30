import { useState } from "react";
import { ActionButton } from "../../ui/ActionButton";
import { PinTabs } from "./Corners";
import styles from "./corners.module.css";
import type { View } from "./view";

/** 能存放的地点（用户定的）：人在自己的安全屋里才出存放入口 */
export function stashHere(view: View): boolean {
  return view.safehouse.homes.some((h) => h.here);
}

/**
 * 存放（用户定的）：不再弹窗，放进右上角地点块里往下长，同四角别的块；
 * 只在能存放的地点出，当前安全屋的存放箱和名下车的后备箱一起列。不调用模型
 */
export function StashBody({
  view,
  onMove,
}: {
  readonly view: View;
  /** 忙的时候不给操作 */
  readonly onMove?: ((action: "store" | "take", item: string, where: string) => void) | undefined;
}) {
  const { homes, trunks, trophies } = view.safehouse;
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
          tabs={boxes.map((b) => [b.id, b.name, 0] as const)}
          value={box.id}
          onChange={setPicked}
        />
      )}
      <section className={styles.peekGroup}>
        <h4>
          {box.name}
          {box.cap !== null && ` ${box.items.length}/${box.cap}`}
        </h4>
        {box.items.length === 0 ? (
          <p className={styles.peekNote}>空的</p>
        ) : (
          <ul className={styles.peekRows}>
            {box.items.map((i) => (
              <li key={i.id}>
                <b>
                  {i.name}
                  {i.count > 1 && ` ×${i.count}`}
                </b>
                {onMove && (
                  <ActionButton onClick={() => onMove("take", i.id, box.id)}>拿出来</ActionButton>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className={styles.peekGroup}>
        <h4>背包</h4>
        {backpack.length === 0 ? (
          <p className={styles.peekNote}>空的</p>
        ) : (
          <ul className={styles.peekRows}>
            {backpack.map(([id, count]) => (
              <li key={id}>
                <b>
                  {itemName(id)}
                  {count > 1 && ` ×${count}`}
                </b>
                {onMove && (
                  <ActionButton
                    disabled={full && !box.items.some((i) => i.id === id)}
                    onClick={() => onMove("store", id, box.id)}
                  >
                    放进去
                  </ActionButton>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {trophies.length > 0 && (
        <section className={styles.peekGroup}>
          <h4>战利品墙</h4>
          <ul className={styles.peekRows}>
            {trophies.map((t) => (
              <li key={`${t.label}-${t.at}`} title={`${t.at}：${t.note}`}>
                <b>{t.label}</b>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
