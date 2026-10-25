import { useEffect, useState } from "react";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { Panel } from "../../ui/Panel";
import styles from "./story.module.css";
import type { View } from "./view";

type ShopView = View["shops"][number];
type Item = ShopView["shelf"][number];
type Sale = ShopView["sell"][number];

/** 按武器类别或物品种类分组，保持货架上的顺序 */
function byGroup(shelf: readonly Item[]): [string, Item[]][] {
  const groups = new Map<string, Item[]>();
  for (const item of shelf) groups.set(item.group, [...(groups.get(item.group) ?? []), item]);
  return [...groups];
}

/** 商店：左边货架，右边背包；不调用模型，买卖都由代码按货架价和回收价结算 */
export function Shop({
  view,
  shop,
  onBuy,
  onSell,
  onClose,
}: {
  readonly view: View;
  readonly shop: ShopView;
  /** 正在生成时不传，按钮不能点 */
  readonly onBuy?: ((id: string) => Promise<void>) | undefined;
  readonly onSell?: ((id: string) => Promise<void>) | undefined;
  readonly onClose: () => void;
}) {
  const [confirming, setConfirming] = useState<
    { kind: "buy"; item: Item } | { kind: "sell"; item: Sale } | null
  >(null);
  const [working, setWorking] = useState(false);
  const eddies = view.money.eddies;
  const money = (n: number) => n.toLocaleString("en-US");

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
      <div role="dialog" aria-label={shop.name} className={styles.journal}>
        <Panel as="div" title={`商店 · ${shop.name}`} line="var(--cp-yellow)">
          <div className={styles.docHead}>
            <p className={`${styles.dim} ${styles.docNote}`}>
              店主{shop.keeper}。{shop.note}
              {shop.blackMarket && "。黑市货便宜，但来路不明。"}
              {shop.restockAt && `。这一批卖过货，${shop.restockAt} 补满。`}
            </p>
            <span>
              身上 <b>{money(eddies)}</b> 欧元
            </span>
            <Button onClick={onClose}>离开</Button>
          </div>

          <div className={styles.shopBody}>
            <div className={styles.docBody}>
              {byGroup(shop.shelf).map(([group, items]) => (
                <section key={group}>
                  <h3 className={styles.docGroup}>{group}</h3>
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
                            {item.rarityLabel && (
                              <small className={styles.cyberSlot}>{item.rarityLabel}</small>
                            )}
                            <span className={styles.docPrice} data-short={short || undefined}>
                              {money(item.price)} 欧元{item.left > 0 && ` · 剩 ${item.left}`}
                            </span>
                            <Button
                              disabled={!onBuy || working || item.locked !== null || short}
                              reason={item.locked ?? (short ? "欧元不够" : undefined)}
                              onClick={() => setConfirming({ kind: "buy", item })}
                            >
                              买
                            </Button>
                          </div>
                          {item.ability && <p className={styles.cyberAbility}>{item.ability}</p>}
                          {item.locked && <p className={styles.docLocked}>{item.locked}</p>}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>

            <section className={styles.shopBag}>
              <h3 className={styles.docGroup}>背包（装备着的先卸下才能卖）</h3>
              {shop.sell.length === 0 ? (
                <p className={styles.dim}>背包是空的。</p>
              ) : (
                <ul className={styles.docList}>
                  {shop.sell.map((s) => (
                    <li key={s.id} className={styles.docItem}>
                      <div className={styles.docItemHead}>
                        <strong>{s.name}</strong>
                        {s.count > 1 && <small className={styles.dim}>×{s.count}</small>}
                        <span className={styles.docPrice}>
                          {s.value > 0 ? `${money(s.value)} 欧元` : "不收"}
                        </span>
                        <Button
                          disabled={!onSell || working || s.value <= 0}
                          reason={s.value <= 0 ? "这家店不收" : undefined}
                          onClick={() => setConfirming({ kind: "sell", item: s })}
                        >
                          卖
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </Panel>
      </div>

      {confirming && (
        <Dialog
          title={
            confirming.kind === "buy"
              ? `买下${confirming.item.name}？`
              : `把${confirming.item.name}卖给${shop.keeper}？`
          }
          tone="info"
          onClose={() => setConfirming(null)}
          actions={
            <>
              <Button
                primary
                disabled={working || !(confirming.kind === "buy" ? onBuy : onSell)}
                onClick={() => {
                  const id = confirming.item.id;
                  const task = confirming.kind === "buy" ? onBuy : onSell;
                  if (task) void run(() => task(id));
                }}
              >
                {working
                  ? "交易中…"
                  : confirming.kind === "buy"
                    ? `付 ${money(confirming.item.price)} 欧元`
                    : `收 ${money(confirming.item.value)} 欧元`}
              </Button>
              <Button onClick={() => setConfirming(null)}>再想想</Button>
            </>
          }
        >
          {confirming.kind === "buy" ? (
            <>
              <p>
                {confirming.item.group}
                {confirming.item.rarityLabel && ` · ${confirming.item.rarityLabel}`}
                ，买下后放进背包。
              </p>
              {confirming.item.ability && <p>{confirming.item.ability}</p>}
            </>
          ) : (
            <p>店里按参考价的两成收，卖了就没了。</p>
          )}
        </Dialog>
      )}
    </div>
  );
}
