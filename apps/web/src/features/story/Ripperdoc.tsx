import { type CSSProperties, useMemo, useState } from "react";
import { Asset } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { CellFrame } from "../../ui/FrameBox";
import { useLayer } from "../../ui/layers";
import { Panel } from "../../ui/Panel";
import { itemArtOf } from "./art";
import { CYBER_LABELS, CyberItemCell, type CyberSlot } from "./CyberDoll";
import { CYBER_SLOT_ICON, RARITY_ORDER, rarityLabelOf, rarityTintOf } from "./cyberwareMeta";
import rip from "./ripperdoc.module.css";
import styles from "./story.module.css";
import type { View } from "./view";

type Doc = NonNullable<View["ripperdoc"]>;
type ShelfItem = Doc["shelf"][number];
type SlotFilter = "all" | "installed" | CyberSlot;

type FocusRef =
  | { readonly kind: "shelf"; readonly id: string }
  | { readonly kind: "installed"; readonly id: string };

const SLOT_ORDER = Object.keys(CYBER_LABELS) as CyberSlot[];

function bySlot(shelf: readonly ShelfItem[]): [CyberSlot, string, ShelfItem[]][] {
  const groups = new Map<CyberSlot, { label: string; items: ShelfItem[] }>();
  for (const item of shelf) {
    const entry = groups.get(item.slot);
    if (entry) entry.items.push(item);
    else groups.set(item.slot, { label: item.slotLabel, items: [item] });
  }
  return [...groups.entries()].map(([slot, entry]) => [slot, entry.label, entry.items]);
}

function money(n: number): string {
  return n.toLocaleString("en-US");
}

/** 义体医生诊所终端：支持部位标签、稀有度与文本检索、已装拆修以及真实手术条件预览 */
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
  const [slotFilter, setSlotFilter] = useState<SlotFilter>("all");
  const [rarityFilter, setRarityFilter] = useState<string>("all");
  const [onlyAffordable, setOnlyAffordable] = useState(false);
  const [onlyInStock, setOnlyInStock] = useState(false);
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState<FocusRef | null>(() =>
    doc.shelf[0]
      ? { kind: "shelf", id: doc.shelf[0].id }
      : view.cyberware[0]
        ? { kind: "installed", id: view.cyberware[0].id }
        : null,
  );
  const [confirming, setConfirming] = useState<ShelfItem | null>(null);
  const [working, setWorking] = useState(false);

  const eddies = view.money.eddies;
  const brokenCount = view.cyberware.filter((c) => c.broken).length;
  const neuralRisk = view.humanity.stage !== "stable" && !view.humanity.suppressed;

  const availableCredit = Math.max(0, doc.credit - (doc.debt?.amount ?? 0));
  const creditable = (item: ShelfItem) =>
    availableCredit > 0 && item.net - eddies <= availableCredit;
  const shortReason = doc.credit > 0 ? "欧元和剩余可赊额度不足" : "欧元不够";
  const owed = confirming ? Math.max(0, confirming.net - eddies) : 0;

  useLayer(onClose, !confirming);

  const run = async (task: () => Promise<void>) => {
    setWorking(true);
    try {
      await task();
      setConfirming(null);
    } catch {
      // 失败原因由外层状态栏或弹窗说明
    } finally {
      setWorking(false);
    }
  };

  const normalizedQuery = query.trim().toLowerCase();

  const equippedBySlot = useMemo(() => {
    const counts = new Map<CyberSlot, number>();
    for (const part of view.cyberware) counts.set(part.slot, (counts.get(part.slot) ?? 0) + 1);
    return counts;
  }, [view.cyberware]);

  const shelfBySlotCount = useMemo(() => {
    const counts = new Map<CyberSlot, number>();
    for (const item of doc.shelf) counts.set(item.slot, (counts.get(item.slot) ?? 0) + 1);
    return counts;
  }, [doc.shelf]);

  const filteredInstalled = useMemo(() => {
    return view.cyberware.filter((c) => {
      if (slotFilter !== "all" && slotFilter !== "installed" && c.slot !== slotFilter) return false;
      if (rarityFilter !== "all" && c.rarity !== rarityFilter) return false;
      if (!normalizedQuery) return true;
      return `${c.name} ${c.slotLabel} ${c.ability ?? ""}`.toLowerCase().includes(normalizedQuery);
    });
  }, [view.cyberware, slotFilter, rarityFilter, normalizedQuery]);

  const filteredShelf = useMemo(() => {
    if (slotFilter === "installed") return [];
    return doc.shelf.filter((item) => {
      if (slotFilter !== "all" && item.slot !== slotFilter) return false;
      if (rarityFilter !== "all" && item.rarity !== rarityFilter) return false;
      if (onlyInStock && item.inStock <= 0) return false;
      if (onlyAffordable && item.net > eddies + availableCredit) return false;
      if (!normalizedQuery) return true;
      return `${item.name} ${item.slotLabel} ${item.ability}`
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [
    doc.shelf,
    slotFilter,
    rarityFilter,
    onlyInStock,
    onlyAffordable,
    eddies,
    availableCredit,
    normalizedQuery,
  ]);

  const activeShelf =
    focus?.kind === "shelf"
      ? (filteredShelf.find((i) => i.id === focus.id) ?? doc.shelf.find((i) => i.id === focus.id))
      : undefined;
  const activeInstalled =
    focus?.kind === "installed"
      ? (filteredInstalled.find((i) => i.id === focus.id) ??
        view.cyberware.find((i) => i.id === focus.id))
      : undefined;

  const fallbackShelf = !activeShelf && !activeInstalled ? filteredShelf[0] : undefined;
  const fallbackInstalled =
    !activeShelf && !activeInstalled && !fallbackShelf ? filteredInstalled[0] : undefined;

  const inspectedShelf = activeShelf ?? fallbackShelf;
  const inspectedInstalled = !inspectedShelf ? (activeInstalled ?? fallbackInstalled) : undefined;

  const groupedShelf = bySlot(filteredShelf);

  const renderInspector = () => {
    if (inspectedShelf) {
      const item = inspectedShelf;
      const art = itemArtOf(item.id);
      const rarityTint = rarityTintOf(item.rarity, item.iconic);
      const rarityLabel = rarityLabelOf(item.rarity, item.iconic);
      const short = item.net > eddies;
      const credit = short && creditable(item);

      return (
        <div
          key={`shelf-${item.id}`}
          className={rip.inspector}
          style={{ "--rarity": rarityTint } as CSSProperties}
        >
          <CellFrame />
          <div className={rip.showcaseFlat}>
            {art ? (
              <Asset id={art} alt={item.name} className={rip.showcaseArt} />
            ) : (
              <Asset id={CYBER_SLOT_ICON[item.slot]} height={48} tint={rarityTint} />
            )}
          </div>

          <div className={rip.inspectorHead}>
            <h3 className={rip.inspectorTitle}>{item.name}</h3>
            <p className={rip.inspectorSub} data-tone={item.locked ? "bad" : undefined}>
              {[
                rarityLabel,
                CYBER_LABELS[item.slot],
                item.installed ? "已装备" : null,
                item.locked ? "不可手术" : item.inStock > 0 ? `现货 ${item.inStock} 件` : "无现货",
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>

          <p className={rip.inspectorAbility}>{item.ability}</p>

          <div className={rip.impactList}>
            <div className={rip.impactRow}>
              <span>手术报价</span>
              <strong>{money(item.price)} 欧元</strong>
            </div>
            {item.replaces && (
              <div className={rip.impactRow}>
                <span>替换 · {item.replaces}</span>
                <strong data-tone="cyan">折抵 −{money(item.tradeIn)} 欧元</strong>
              </div>
            )}
            <div className={rip.impactRow}>
              <span>实际应付</span>
              <strong data-tone={short && !credit ? "bad" : credit ? "cyan" : undefined}>
                {money(item.net)} 欧元{credit ? `（需赊 ${money(item.net - eddies)}）` : ""}
              </strong>
            </div>
            <div className={rip.impactRow}>
              <span>诊所库存</span>
              <strong data-tone={item.inStock <= 0 ? "bad" : undefined}>
                {item.inStock > 0 ? `${item.inStock} 件现货` : "缺货"}
              </strong>
            </div>
            {neuralRisk && (
              <p className={rip.impactWarn}>
                神经风险提醒：当前处于「{view.humanity.stageLabel}
                」状态，继续植入或更换高负载义体可能加重神经排异。
              </p>
            )}
            {item.locked && <p className={rip.impactWarn}>{item.locked}</p>}
          </div>

          <div className={rip.inspectorActions}>
            {item.installed ? (
              <>
                {doc.repair[item.id] !== undefined && (
                  <Button
                    primary
                    disabled={!onRepair || working || (doc.repair[item.id] ?? 0) > eddies}
                    reason={(doc.repair[item.id] ?? 0) > eddies ? "欧元不够" : undefined}
                    onClick={() => onRepair && void run(() => onRepair(item.id))}
                  >
                    维修（{money(doc.repair[item.id] ?? 0)} 欧元）
                  </Button>
                )}
                <Button
                  disabled={!onRemove || working}
                  onClick={() => onRemove && void run(() => onRemove(item.id))}
                >
                  {doc.buyback[item.id]
                    ? `卸下（回收 ${money(doc.buyback[item.id] ?? 0)}）`
                    : "卸下此义体"}
                </Button>
              </>
            ) : (
              <Button
                primary
                disabled={!onBuy || working || item.locked !== null || (short && !credit)}
                reason={item.locked ?? (short && !credit ? shortReason : undefined)}
                onClick={() => setConfirming(item)}
              >
                {credit ? "赊账安装此义体" : "预约安装手术"}
              </Button>
            )}
          </div>
        </div>
      );
    }

    if (inspectedInstalled) {
      const part = inspectedInstalled;
      const art = itemArtOf(part.id);
      const rarityTint = rarityTintOf(part.rarity, part.iconic);
      const rarityLabel = rarityLabelOf(part.rarity, part.iconic);
      const repairPrice = doc.repair[part.id];
      const buyback = doc.buyback[part.id] ?? 0;

      return (
        <div
          key={`inst-${part.id}`}
          className={rip.inspector}
          style={{ "--rarity": rarityTint } as CSSProperties}
        >
          <CellFrame />
          <div className={rip.showcaseFlat}>
            {art ? (
              <Asset id={art} alt={part.name} className={rip.showcaseArt} />
            ) : (
              <Asset id={CYBER_SLOT_ICON[part.slot]} height={48} tint={rarityTint} />
            )}
          </div>

          <div className={rip.inspectorHead}>
            <h3 className={rip.inspectorTitle}>{part.name}</h3>
            <p className={rip.inspectorSub} data-tone={part.broken ? "bad" : undefined}>
              {[rarityLabel, CYBER_LABELS[part.slot], part.broken ? "已损毁 · 待修" : "正常运行"]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>

          {part.ability && <p className={rip.inspectorAbility}>{part.ability}</p>}

          <div className={rip.impactList}>
            <div className={rip.impactRow}>
              <span>安装部位</span>
              <strong>{CYBER_LABELS[part.slot]}</strong>
            </div>
            <div className={rip.impactRow}>
              <span>硬件状况</span>
              <strong data-tone={part.broken ? "bad" : "cyan"}>
                {part.broken ? "已损毁（失去功能）" : "正常运行"}
              </strong>
            </div>
            {buyback > 0 && (
              <div className={rip.impactRow}>
                <span>折价回收</span>
                <strong>+{money(buyback)} 欧元</strong>
              </div>
            )}
            {repairPrice !== undefined && (
              <div className={rip.impactRow}>
                <span>维修报价</span>
                <strong data-tone={repairPrice > eddies ? "bad" : "cyan"}>
                  {money(repairPrice)} 欧元
                </strong>
              </div>
            )}
          </div>

          <div className={rip.inspectorActions}>
            {repairPrice !== undefined && (
              <Button
                primary
                disabled={!onRepair || working || repairPrice > eddies}
                reason={repairPrice > eddies ? "欧元不够" : undefined}
                onClick={() => onRepair && void run(() => onRepair(part.id))}
              >
                修好（{money(repairPrice)} 欧元）
              </Button>
            )}
            <Button
              disabled={!onRemove || working}
              onClick={() => onRemove && void run(() => onRemove(part.id))}
            >
              {buyback > 0 ? `卸下并回收 ${money(buyback)} 欧元` : "卸下此义体"}
            </Button>
          </div>
        </div>
      );
    }

    return <div className={rip.emptyState}>当前筛选条件下没有可展示的义体。</div>;
  };

  return (
    <div className={styles.journalBackdrop}>
      <div role="dialog" aria-label={`义体医生${doc.name}`} className={rip.clinicModal}>
        <Panel as="div" title={`义体诊所 · ${doc.name}`} line="var(--cp-cyan)" frame>
          <div className={rip.clinicShell}>
            {/* 诊所与患者生命体征顶栏 */}
            <header className={rip.clinicTop}>
              <div className={rip.docProfile}>
                <div className={rip.docAvatarBox}>
                  <CellFrame />
                  {doc.id === "viktor" ? (
                    <Asset
                      id="portrait.viktor"
                      height={56}
                      alt={doc.name}
                      className={rip.docPortrait}
                    />
                  ) : (
                    <Asset id="map.poi.ripperdoc" height={28} tint="var(--cp-cyan)" />
                  )}
                </div>
                <div className={rip.docMeta}>
                  <p className={rip.docNote}>{doc.note}</p>
                  <p className={rip.docMetaLine} data-warn={doc.blackMarket || undefined}>
                    {[
                      doc.blackMarket ? "黑市货源 · −20%（无保修）" : "认证诊所",
                      doc.credit > 0 ? `剩余可赊 ${money(availableCredit)} 欧元` : null,
                      doc.affinity !== null ? `好感 ${doc.affinity}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
              </div>

              <div className={rip.vitalsLine}>
                <span>
                  <b>{money(eddies)}</b> 欧元
                </span>
                <span data-tone={neuralRisk ? "bad" : "cyan"}>
                  神经状态：{view.humanity.stageLabel}
                </span>
                {brokenCount > 0 && <span data-tone="bad">损毁 {brokenCount}</span>}
                <Button small onClick={onClose}>
                  离开
                </Button>
              </div>
            </header>

            {/* 欠款催缴告警条 */}
            {doc.debt && (
              <div className={rip.debtBanner} role="status">
                <CellFrame />
                <Asset id="notify.warning" height={18} tint="var(--cp-red)" />
                <span className={rip.debtText}>
                  欠 {doc.name} <b>{money(doc.debt.amount)}</b> 欧元，
                  {doc.debt.due === "未约定期限"
                    ? "未约定还款期限"
                    : `最早还款期限：${doc.debt.due}`}
                </span>
                <Button
                  small
                  primary={doc.debt.amount <= eddies}
                  disabled={!onRepay || working || doc.debt.amount > eddies}
                  reason={doc.debt.amount > eddies ? "欧元不够" : undefined}
                  onClick={() => onRepay && void run(onRepay)}
                >
                  还清欠款
                </Button>
              </div>
            )}

            {/* 部位标签 + 稀有度/文本检索 */}
            <nav className={rip.navSection} aria-label="诊所货架筛选">
              <div className={rip.slotBar}>
                <button
                  type="button"
                  className={rip.slotBtn}
                  aria-pressed={slotFilter === "all"}
                  onClick={() => setSlotFilter("all")}
                >
                  全部
                </button>
                <button
                  type="button"
                  className={rip.slotBtn}
                  aria-pressed={slotFilter === "installed"}
                  onClick={() => setSlotFilter("installed")}
                >
                  已装
                </button>
                {SLOT_ORDER.map((slot) => {
                  const eq = equippedBySlot.get(slot) ?? 0;
                  const shelfN = shelfBySlotCount.get(slot) ?? 0;
                  if (eq === 0 && shelfN === 0) return null;
                  return (
                    <button
                      key={slot}
                      type="button"
                      className={rip.slotBtn}
                      aria-pressed={slotFilter === slot}
                      onClick={() => setSlotFilter(slot)}
                    >
                      {CYBER_LABELS[slot]}
                    </button>
                  );
                })}
              </div>

              <div className={rip.filterRow}>
                <div className={rip.rarityRow}>
                  <button
                    type="button"
                    className={rip.filterChip}
                    aria-pressed={rarityFilter === "all"}
                    onClick={() => setRarityFilter("all")}
                  >
                    全稀有度
                  </button>
                  {RARITY_ORDER.map((r) => (
                    <button
                      key={r}
                      type="button"
                      className={rip.filterChip}
                      data-rarity={r}
                      aria-pressed={rarityFilter === r}
                      onClick={() => setRarityFilter((cur) => (cur === r ? "all" : r))}
                    >
                      {rarityLabelOf(r)}
                    </button>
                  ))}
                  {slotFilter !== "installed" && (
                    <>
                      <button
                        type="button"
                        className={rip.filterChip}
                        aria-pressed={onlyInStock}
                        onClick={() => setOnlyInStock((v) => !v)}
                      >
                        仅看有现货
                      </button>
                      <button
                        type="button"
                        className={rip.filterChip}
                        aria-pressed={onlyAffordable}
                        onClick={() => setOnlyAffordable((v) => !v)}
                      >
                        仅看可负担
                      </button>
                    </>
                  )}
                </div>

                <div className={rip.searchWrap}>
                  <CellFrame />
                  <input
                    type="search"
                    className={rip.searchInput}
                    aria-label="筛选义体名称或效果"
                    placeholder="检索义体名称 / 部位 / 效果…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
              </div>
            </nav>

            {/* 双栏工作区：左已装+货架，右手术检视台 */}
            <div className={rip.clinicSplit}>
              <div className={rip.leftCol}>
                {filteredInstalled.length > 0 && (
                  <section className={rip.groupSection}>
                    <h3 className={rip.groupTitle} data-installed>
                      <span>身上已装义体（{filteredInstalled.length}）</span>
                    </h3>
                    <ul className={rip.cardList}>
                      {filteredInstalled.map((c) => {
                        const isSelected = inspectedInstalled?.id === c.id;
                        const rarityTint = rarityTintOf(c.rarity, c.iconic);
                        const rarityLabel = rarityLabelOf(c.rarity, c.iconic);
                        const repairPrice = doc.repair[c.id];
                        const buyback = doc.buyback[c.id] ?? 0;
                        return (
                          <li
                            key={c.id}
                            className={rip.card}
                            data-selected={isSelected || undefined}
                            style={{ "--rarity": rarityTint } as CSSProperties}
                          >
                            <CellFrame />
                            <button
                              type="button"
                              className={rip.cardMain}
                              onClick={() => setFocus({ kind: "installed", id: c.id })}
                            >
                              <CyberItemCell
                                id={c.id}
                                name={c.name}
                                slot={c.slot}
                                rarity={c.rarity ?? undefined}
                                iconic={c.iconic}
                                broken={c.broken}
                                on
                                size={44}
                              />
                              <span className={rip.cardInfo}>
                                <span className={rip.cardNameRow}>
                                  <strong className={rip.cardName}>{c.name}</strong>
                                  {c.broken && (
                                    <span className={rip.cardState} data-tone="bad">
                                      已损毁
                                    </span>
                                  )}
                                </span>
                                <span className={rip.cardSub}>
                                  {[rarityLabel, CYBER_LABELS[c.slot]].filter(Boolean).join(" · ")}
                                </span>
                              </span>
                            </button>
                            <div className={rip.cardActions}>
                              {repairPrice !== undefined && (
                                <Button
                                  small
                                  primary
                                  disabled={!onRepair || working || repairPrice > eddies}
                                  reason={repairPrice > eddies ? "欧元不够" : undefined}
                                  onClick={() => onRepair && void run(() => onRepair(c.id))}
                                >
                                  修好（{money(repairPrice)}）
                                </Button>
                              )}
                              <Button
                                small
                                disabled={!onRemove || working}
                                onClick={() => onRemove && void run(() => onRemove(c.id))}
                              >
                                {buyback > 0 ? `卸下（+${money(buyback)}）` : "卸下"}
                              </Button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                )}

                {slotFilter !== "installed" &&
                  (groupedShelf.length === 0 ? (
                    <div className={rip.emptyState}>
                      当前筛选条件在{doc.name}的货架里没有匹配的义体。
                    </div>
                  ) : (
                    groupedShelf.map(([slot, label, items]) => (
                      <section key={slot} className={rip.groupSection}>
                        <h3 className={rip.groupTitle}>{CYBER_LABELS[slot] ?? label}</h3>
                        <ul className={rip.cardList}>
                          {items.map((item) => {
                            const isSelected = inspectedShelf?.id === item.id;
                            const rarityTint = rarityTintOf(item.rarity, item.iconic);
                            const short = item.net > eddies;
                            const credit = short && creditable(item);
                            return (
                              <li
                                key={item.id}
                                className={rip.card}
                                data-selected={isSelected || undefined}
                                data-locked={item.locked !== null || undefined}
                                style={{ "--rarity": rarityTint } as CSSProperties}
                              >
                                <CellFrame />
                                <button
                                  type="button"
                                  className={rip.cardMain}
                                  onClick={() => setFocus({ kind: "shelf", id: item.id })}
                                >
                                  <CyberItemCell
                                    id={item.id}
                                    name={item.name}
                                    slot={item.slot}
                                    rarity={item.rarity}
                                    iconic={item.iconic}
                                    on={item.installed}
                                    size={46}
                                  />
                                  <span className={rip.cardInfo}>
                                    <span className={rip.cardNameRow}>
                                      <strong className={rip.cardName}>{item.name}</strong>
                                      {item.installed && (
                                        <span className={rip.cardState}>已装</span>
                                      )}
                                    </span>
                                    <span className={rip.cardSub}>
                                      {[
                                        item.rarityLabel,
                                        item.inStock > 0 ? `现货 ${item.inStock}` : "缺货",
                                        item.replaces ? `换下 ${item.replaces}` : null,
                                      ]
                                        .filter(Boolean)
                                        .join(" · ")}
                                    </span>
                                    {item.locked && <p className={rip.lockNote}>{item.locked}</p>}
                                  </span>
                                </button>
                                <div className={rip.cardRight}>
                                  <div className={rip.priceBlock}>
                                    <span
                                      className={rip.priceMain}
                                      data-credit={credit || undefined}
                                      data-short={(short && !credit) || undefined}
                                    >
                                      {money(item.net)} 欧元
                                    </span>
                                    {item.tradeIn > 0 && (
                                      <span className={rip.priceSub}>
                                        旧件抵 {money(item.tradeIn)}
                                      </span>
                                    )}
                                  </div>
                                  {!item.installed && (
                                    <Button
                                      small
                                      disabled={
                                        !onBuy ||
                                        working ||
                                        item.locked !== null ||
                                        (short && !credit)
                                      }
                                      reason={
                                        item.locked ?? (short && !credit ? shortReason : undefined)
                                      }
                                      onClick={() => setConfirming(item)}
                                    >
                                      {credit ? "赊账装上" : "装上"}
                                    </Button>
                                  )}
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </section>
                    ))
                  ))}
              </div>

              <aside className={rip.rightCol} aria-label="手术详情预览">
                {renderInspector()}
              </aside>
            </div>
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
                disabled={
                  working ||
                  !onBuy ||
                  confirming.locked !== null ||
                  (owed > 0 && !creditable(confirming))
                }
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
            {confirming.slotLabel} · {rarityLabelOf(confirming.rarity, confirming.iconic)}
            {confirming.bonusText && `，${confirming.bonusText}`}
            {confirming.replaces &&
              `；会换下${confirming.replaces}${
                confirming.tradeIn > 0
                  ? `，${doc.name}折价抵 ${money(confirming.tradeIn)} 欧元`
                  : ""
              }`}
            。
          </p>
          <p>{confirming.ability}</p>
          {neuralRisk && (
            <p className={rip.lockNote}>
              当前神经状态为「{view.humanity.stageLabel}」，术后建议留意神经排异症状。
            </p>
          )}
          {owed > 0 && (
            <p className={rip.lockNote}>
              身上的 {money(eddies)} 欧元全付掉，剩下 {money(owed)} 欧元赊着。
              {doc.creditDays === null
                ? "这笔欠款未约定还款期限。"
                : `这笔欠款需在 ${doc.creditDays} 天内还清。`}
            </p>
          )}
        </Dialog>
      )}
    </div>
  );
}
