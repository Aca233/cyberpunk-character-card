import { useEffect, useState } from "react";
import { ActionButton } from "../../ui/ActionButton";
import { Button } from "../../ui/Button";
import { Panel } from "../../ui/Panel";
import styles from "./story.module.css";
import type { View } from "./view";

/** 存放箱和后备箱：在安全屋里能用存放箱，后备箱随时能用；不调用模型 */
export function StashPanel({
  view,
  onMove,
  onClose,
}: {
  readonly view: View;
  /** 忙的时候不给操作 */
  readonly onMove?: ((action: "store" | "take", item: string, where: string) => void) | undefined;
  readonly onClose: () => void;
}) {
  const { homes, trunks, trophies } = view.safehouse;
  const boxes = [
    ...homes.map((h) => ({
      id: h.id,
      name: `${h.name}的存放箱`,
      usable: h.here,
      hint: h.here ? "" : `在${h.locationName}，回去才能用`,
      items: h.items,
      cap: null as number | null,
    })),
    ...trunks.map((t) => ({
      id: t.id,
      name: t.name,
      usable: true,
      hint: "",
      items: t.items,
      cap: t.cap,
    })),
  ];
  const [picked, setPicked] = useState(boxes.find((b) => b.usable)?.id ?? boxes[0]?.id ?? null);
  const box = boxes.find((b) => b.id === picked);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const backpack = Object.entries(view.inventory.backpack);
  const itemName = (id: string) => view.names.items[id] ?? id;
  const full = box !== undefined && box.cap !== null && box.items.length >= box.cap;
  const move = box?.usable ? onMove : undefined;

  return (
    <div className={styles.journalBackdrop}>
      <div role="dialog" aria-label="存放" className={styles.journal}>
        <Panel as="div" title="存放" line="var(--cp-yellow)">
          <div className={styles.docHead}>
            <Button onClick={onClose}>关闭</Button>
          </div>
          {boxes.length === 0 ? (
            <p className={styles.dim}>还没有安全屋，也没有车。</p>
          ) : (
            <div className={styles.docBody}>
              <div className={styles.mapLayers}>
                {boxes.map((b) => (
                  <Button
                    key={b.id}
                    small
                    pressed={b.id === picked}
                    onClick={() => setPicked(b.id)}
                  >
                    {b.name}
                  </Button>
                ))}
              </div>
              {box && (
                <div className={styles.stashColumns}>
                  <section>
                    <h3 className={styles.mapTitle}>背包</h3>
                    <ul className={styles.stashList}>
                      {backpack.length === 0 && <li className={styles.dim}>空的</li>}
                      {backpack.map(([id, count]) => (
                        <li key={id} className={styles.stashRow}>
                          <span>
                            {itemName(id)}
                            {count > 1 && ` ×${count}`}
                          </span>
                          {move && (
                            <ActionButton
                              disabled={full && !box.items.some((i) => i.id === id)}
                              onClick={() => move("store", id, box.id)}
                            >
                              放进去
                            </ActionButton>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                  <section>
                    <h3 className={styles.mapTitle}>
                      {box.name}
                      {box.cap !== null && (
                        <span className={styles.dim}>
                          {" "}
                          {box.items.length}/{box.cap} 格
                        </span>
                      )}
                    </h3>
                    {box.hint && <p className={styles.dim}>{box.hint}</p>}
                    <ul className={styles.stashList}>
                      {box.items.length === 0 && <li className={styles.dim}>空的</li>}
                      {box.items.map((i) => (
                        <li key={i.id} className={styles.stashRow}>
                          <span>
                            {i.name}
                            {i.count > 1 && ` ×${i.count}`}
                          </span>
                          {move && (
                            <ActionButton onClick={() => move("take", i.id, box.id)}>
                              拿出来
                            </ActionButton>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                </div>
              )}
              {trophies.length > 0 && (
                <section>
                  <h3 className={styles.mapTitle}>战利品墙</h3>
                  <ul className={styles.stashList}>
                    {trophies.map((t) => (
                      <li key={`${t.label}-${t.at}`}>
                        <details>
                          <summary>{t.label}</summary>
                          <p className={styles.dim}>
                            {t.at}：{t.note}
                          </p>
                        </details>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
