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
  onRepay,
  onRepair,
  onClose,
}: {
  readonly view: View;
  readonly doc: Doc;
  /** 正在生成时不传，按钮不能点；credit 是钱不够时赊账 */
  readonly onBuy?: ((id: string, credit: boolean) => Promise<void>) | undefined;
  readonly onRemove?: ((id: string) => Promise<void>) | undefined;
  readonly onRepay?: (() => Promise<void>) | undefined;
  /** 修好一件打坏的义体 */
  readonly onRepair?: ((id: string) => Promise<void>) | undefined;
  readonly onClose: () => void;
}) {
  const [confirming, setConfirming] = useState<Item | null>(null);
  const [working, setWorking] = useState(false);
  const eddies = view.money.eddies;
  const money = (n: number) => n.toLocaleString("en-US");
  /** 钱不够时这位医生肯不肯赊：肯赊、没有旧账、差额在额度内 */
  const creditable = (item: Item) =>
    doc.credit > 0 && doc.debt === null && item.net - eddies <= doc.credit;
  const owed = confirming ? Math.max(0, confirming.net - eddies) : 0;

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
              身上 <b>{money(eddies)}</b> 欧元
            </span>
            <Button onClick={onClose}>离开</Button>
          </div>
          {doc.debt ? (
            <div className={styles.docDebt} role="status">
              <span>
                欠{doc.name} <b>{money(doc.debt.amount)}</b> 欧元，{doc.debt.due} 前还清
              </span>
              <Button
                disabled={!onRepay || working || doc.debt.amount > eddies}
                reason={doc.debt.amount > eddies ? "欧元不够" : undefined}
                onClick={() => onRepay && void run(onRepay)}
              >
                还清
              </Button>
            </div>
          ) : (
            doc.credit > 0 && (
              <p className={`${styles.dim} ${styles.docNote}`}>
                钱不够时肯赊账，最多 {money(doc.credit)} 欧元，7 天内还清。
              </p>
            )
          )}

          <div className={styles.docBody}>
            {view.cyberware.length > 0 && (
              <section>
                <h3 className={styles.docGroup}>身上装着的</h3>
                <ul className={styles.docList}>
                  {view.cyberware.map((c) => (
                    <li key={c.id} className={styles.docItem}>
                      <div className={styles.docItemHead}>
                        <strong>{c.name}</strong>
                        <small className={styles.cyberSlot}>
                          {c.slotLabel}
                          {c.broken && " · 打坏了"}
                        </small>
                        {doc.repair[c.id] !== undefined && (
                          <Button
                            disabled={!onRepair || working || (doc.repair[c.id] ?? 0) > eddies}
                            onClick={() => onRepair && void run(() => onRepair(c.id))}
                          >
                            修好（{money(doc.repair[c.id] ?? 0)}）
                          </Button>
                        )}
                        <Button
                          disabled={!onRemove || working}
                          onClick={() => onRemove && void run(() => onRemove(c.id))}
                        >
                          {doc.buyback[c.id]
                            ? `卸下（回收 ${money(doc.buyback[c.id] ?? 0)}）`
                            : "卸下"}
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
                    const short = item.net > eddies;
                    const credit = short && creditable(item);
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
                            {money(item.net)} 欧元
                            {item.tradeIn > 0 && (
                              <small className={styles.dim}>（旧件抵 {money(item.tradeIn)}）</small>
                            )}
                          </span>
                          {item.installed ? (
                            <small className={styles.dim}>装着</small>
                          ) : (
                            <Button
                              disabled={
                                !onBuy || working || item.locked !== null || (short && !credit)
                              }
                              reason={
                                item.locked ??
                                (short && !credit
                                  ? doc.debt
                                    ? "欧元不够，旧账没还清不再赊"
                                    : "欧元不够"
                                  : undefined)
                              }
                              onClick={() => setConfirming(item)}
                            >
                              {credit ? "赊账装上" : "装上"}
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
                onClick={() => onBuy && void run(() => onBuy(confirming.id, owed > 0))}
              >
                {working
                  ? "装着呢…"
                  : owed > 0
                    ? `付 ${money(eddies)}，赊 ${money(owed)}`
                    : `付 ${money(confirming.net)} 欧元`}
              </Button>
              <Button onClick={() => setConfirming(null)}>再想想</Button>
            </>
          }
        >
          <p>
            {confirming.slotLabel} · {confirming.rarityLabel}，人性上限 −{confirming.humanityCost}
            {confirming.bonusText && `，${confirming.bonusText}`}
            {confirming.replaces &&
              `；会换下${confirming.replaces}${confirming.tradeIn > 0 ? `，${doc.name}折价抵 ${money(confirming.tradeIn)} 欧元` : ""}`}
            。
          </p>
          <p>{confirming.ability}</p>
          {owed > 0 && (
            <p className={styles.docLocked}>
              身上的 {money(eddies)} 欧元全付掉，剩下 {money(owed)} 欧元赊着，7 天内还清；到期不还
              {doc.name}会找上门。
            </p>
          )}
        </Dialog>
      )}
    </div>
  );
}
