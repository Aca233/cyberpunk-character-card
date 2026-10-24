import { useEffect, useState } from "react";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { Panel } from "../../ui/Panel";
import styles from "./story.module.css";
import type { View } from "./view";

type Doc = NonNullable<View["ripperdoc"]>;
type Item = Doc["shelf"][number];

/** 按部位分组，保持货架上的顺序 */
function bySlot(shelf: readonly Item[]): [string, Item[]][] {
  const groups = new Map<string, Item[]>();
  for (const item of shelf)
    groups.set(item.slotLabel, [...(groups.get(item.slotLabel) ?? []), item]);
  return [...groups];
}

/** 义体医生的货架：不调用模型，买、卸都由代码按货架价结算 */
export function Ripperdoc({
  view,
  doc,
  onBuy,
  onRemove,
  onClose,
}: {
  readonly view: View;
  readonly doc: Doc;
  /** 正在生成时不传，按钮不能点 */
  readonly onBuy?: ((id: string) => Promise<void>) | undefined;
  readonly onRemove?: ((id: string) => Promise<void>) | undefined;
  readonly onClose: () => void;
}) {
  const [confirming, setConfirming] = useState<Item | null>(null);
  const [working, setWorking] = useState(false);
  const eddies = view.money.eddies;

  // 确认框开着时 Esc 只关确认框
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !confirming) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirming, onClose]);

  const run = async (task: () => Promise<void>) => {
    setWorking(true);
    try {
      await task();
      setConfirming(null);
    } catch {
      // 失败原因由提示条说明，确认框留着
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className={styles.journalBackdrop}>
      <div role="dialog" aria-label={`义体医生${doc.name}`} className={styles.journal}>
        <Panel as="div" title={`义体医生 · ${doc.name}`} line="var(--cp-cyan)">
          <div className={styles.docHead}>
            <p className={`${styles.dim} ${styles.docNote}`}>
              {doc.note}
              {doc.blackMarket && "。黑市货便宜，但来路不明，可能有故障或追踪器。"}
            </p>
            <span>
              身上 <b>{eddies.toLocaleString("en-US")}</b> 欧元
            </span>
            <Button onClick={onClose}>离开</Button>
          </div>

          <div className={styles.docBody}>
            {view.cyberware.length > 0 && (
              <section>
                <h3 className={styles.docGroup}>身上装着的</h3>
                <ul className={styles.docList}>
                  {view.cyberware.map((c) => (
                    <li key={c.id} className={styles.docItem}>
                      <div className={styles.docItemHead}>
                        <strong>{c.name}</strong>
                        <small className={styles.cyberSlot}>{c.slotLabel}</small>
                        <Button
                          disabled={!onRemove || working}
                          onClick={() => onRemove && void run(() => onRemove(c.id))}
                        >
                          卸下
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {bySlot(doc.shelf).map(([slot, items]) => (
              <section key={slot}>
                <h3 className={styles.docGroup}>{slot}</h3>
                <ul className={styles.docList}>
                  {items.map((item) => {
                    const short = item.price > eddies;
                    return (
                      <li
                        key={item.id}
                        className={styles.docItem}
                        data-locked={item.locked !== null || undefined}
                      >
                        <div className={styles.docItemHead}>
                          <strong>{item.name}</strong>
                          <small className={styles.cyberSlot}>
                            {item.rarityLabel} · 人性上限 −{item.humanityCost}
                          </small>
                          <span className={styles.docPrice} data-short={short || undefined}>
                            {item.price.toLocaleString("en-US")} 欧元
                          </span>
                          {item.installed ? (
                            <small className={styles.dim}>装着</small>
                          ) : (
                            <Button
                              disabled={!onBuy || working || item.locked !== null || short}
                              reason={item.locked ?? (short ? "欧元不够" : undefined)}
                              onClick={() => setConfirming(item)}
                            >
                              装上
                            </Button>
                          )}
                        </div>
                        <p className={styles.cyberAbility}>
                          {item.ability}
                          {item.bonusText && `（${item.bonusText}）`}
                        </p>
                        {item.locked && <p className={styles.docLocked}>{item.locked}</p>}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        </Panel>
      </div>

      {confirming && (
        <Dialog
          title={`装上${confirming.name}？`}
          tone="info"
          onClose={() => setConfirming(null)}
          actions={
            <>
              <Button
                primary
                disabled={working || !onBuy}
                onClick={() => onBuy && void run(() => onBuy(confirming.id))}
              >
                {working ? "装着呢…" : `付 ${confirming.price.toLocaleString("en-US")} 欧元`}
              </Button>
              <Button onClick={() => setConfirming(null)}>再想想</Button>
            </>
          }
        >
          <p>
            {confirming.slotLabel} · {confirming.rarityLabel}，人性上限 −{confirming.humanityCost}
            {confirming.bonusText && `，${confirming.bonusText}`}
            {confirming.replaces && `；会换下${confirming.replaces}（不折价回收）`}。
          </p>
          <p>{confirming.ability}</p>
        </Dialog>
      )}
    </div>
  );
}
