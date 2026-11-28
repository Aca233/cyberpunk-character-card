import { cyberwareRules } from "@cp/core";
import { type CSSProperties, useMemo, useState } from "react";
import { Asset } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { CellFrame } from "../../ui/FrameBox";
import { useLayer } from "../../ui/layers";
import { Panel } from "../../ui/Panel";
import { itemArtOf, portraitOf } from "./art";
import { CyberItemCell, NeuralLoadBar } from "./CyberDoll";
import { CYBER_SLOT_ICON, RARITY_ORDER, rarityLabelOf, rarityTintOf } from "./cyberwareMeta";
import rip from "./ripperdoc.module.css";
import styles from "./story.module.css";
import type { View } from "./view";

type Doc = NonNullable<View["ripperdoc"]>;
type ShelfItem = Doc["shelf"][number];
type CategoryId = cyberwareRules.CyberwareCategoryId;
type CategoryFilter = "all" | "installed" | CategoryId;

type FocusRef =
  | { readonly kind: "shelf"; readonly id: string }
  | { readonly kind: "installed"; readonly id: string };

const CATEGORY_ORDER = cyberwareRules.CYBERWARE_CATEGORY_IDS;
const CATEGORY_LABELS = cyberwareRules.CYBERWARE_CATEGORY_LABELS;

function money(n: number): string {
  return n.toLocaleString("en-US");
}

function groupShelfByCategory(shelf: readonly ShelfItem[]): [CategoryId, string, ShelfItem[]][] {
  const groups = new Map<CategoryId, ShelfItem[]>();
  for (const item of shelf) {
    const list = groups.get(item.category);
    if (list) list.push(item);
    else groups.set(item.category, [item]);
  }
  return CATEGORY_ORDER.flatMap((cat) => {
    const items = groups.get(cat);
    return items ? ([[cat, CATEGORY_LABELS[cat], items]] as const) : [];
  });
}

/** 义体医生诊所终端 v2：复用三段式神经承载条、8 核心主位 + 5 扩展区分类、元素变体收拢与真左右臂手术 */
export function Ripperdoc({
  view,
  doc,
  initialCategory = "all",
  initialInstalledId,
  onBuy,
  onRemove,
  onRepay,
  onRepair,
  onPayChromeCare,
  onClose,
}: {
  readonly view: View;
  readonly doc: Doc;
  readonly initialCategory?: CategoryFilter | undefined;
  readonly initialInstalledId?: string | undefined;
  readonly onBuy?:
    | ((
        id: string,
        credit: boolean,
        options?: {
          readonly armSide?: cyberwareRules.ArmSide;
          readonly replace?: string;
          readonly forNpc?: string;
        },
      ) => Promise<void>)
    | undefined;
  readonly onRemove?: ((id: string) => Promise<void>) | undefined;
  readonly onRepay?: (() => Promise<void>) | undefined;
  readonly onRepair?: ((id: string) => Promise<void>) | undefined;
  readonly onPayChromeCare?: (() => Promise<void>) | undefined;
  readonly onClose: () => void;
}) {
  const [catFilter, setCatFilter] = useState<CategoryFilter>(initialCategory);
  const [rarityFilter, setRarityFilter] = useState<string>("all");
  const [onlyAffordable, setOnlyAffordable] = useState(false);
  const [onlyInStock, setOnlyInStock] = useState(false);
  const [query, setQuery] = useState("");
  const [variantChoice, setVariantChoice] = useState<
    Readonly<Record<string, cyberwareRules.ElementVariantKey>>
  >({});
  const [selectedArmSide, setSelectedArmSide] = useState<cyberwareRules.ArmSide>("both");
  const [focus, setFocus] = useState<FocusRef | null>(() => {
    if (initialInstalledId && view.cyberware.some((c) => c.id === initialInstalledId)) {
      return { kind: "installed", id: initialInstalledId };
    }
    const catMatch =
      initialCategory !== "all" && initialCategory !== "installed"
        ? doc.shelf.find((item) => item.category === initialCategory)
        : undefined;
    if (catMatch) return { kind: "shelf", id: catMatch.id };
    if (doc.shelf[0]) return { kind: "shelf", id: doc.shelf[0].id };
    if (view.cyberware[0]) return { kind: "installed", id: view.cyberware[0].id };
    return null;
  });
  const [confirming, setConfirming] = useState<{
    readonly item: ShelfItem;
    readonly armSide?: cyberwareRules.ArmSide;
    readonly replace?: string;
    readonly replaceName?: string;
  } | null>(null);
  const [working, setWorking] = useState(false);
  const [installForNpcId, setInstallForNpcId] = useState<string>("");
  const companions = useMemo(() => view.npcs.filter((n) => n.following && n.alive), [view.npcs]);
  const targetCompanion = companions.find((n) => n.id === installForNpcId) ?? null;

  const eddies = view.money.eddies;
  const chromeCareCost = doc.chromeCare?.cost ?? view.money.chromeCare?.cost ?? 0;
  const chromeCareLock = doc.chromeCare?.blocked ?? null;
  const brokenCount = view.cyberware.filter((c) => c.broken).length;
  const neuralRisk = view.humanity.stage !== "stable" && !view.humanity.suppressed;

  const activeInstalledProbes = useMemo<readonly cyberwareRules.LoadProbe[]>(
    () =>
      view.cyberware
        .filter((c) => !c.broken)
        .map((c) => ({
          id: c.id,
          name: c.name,
          slot: c.slot,
          category: c.category,
          humanityCost: c.humanityCost,
          iconic: c.iconic,
          armor: c.armor,
          accelerator: c.accelerator,
          ...(c.armSide ? { armSide: c.armSide } : {}),
          ...(c.defaultArmSide ? { defaultArmSide: c.defaultArmSide } : {}),
          ...(c.capacityBonus !== undefined ? { capacityBonus: c.capacityBonus } : {}),
          ...(c.safeLineBonus !== undefined ? { safeLineBonus: c.safeLineBonus } : {}),
          ...(c.chassisProfile ? { chassisProfile: c.chassisProfile } : {}),
          ...(c.deckProfile ? { deckProfile: c.deckProfile } : {}),
          ...(c.deckTraits ? { deckTraits: c.deckTraits } : {}),
          ...(c.exclusiveGroup ? { exclusiveGroup: c.exclusiveGroup } : {}),
        })),
    [view.cyberware],
  );

  const currentLoad = useMemo(
    () => cyberwareRules.cyberwareLoadProfile(activeInstalledProbes),
    [activeInstalledProbes],
  );

  const evaluateShelfInstall = (item: ShelfItem, armSide?: cyberwareRules.ArmSide) => {
    const isArm = item.category === "arms";
    const side = isArm ? (armSide ?? cyberwareRules.defaultArmSideFor(item)) : undefined;
    const probe: cyberwareRules.LoadProbe = {
      id: item.id,
      name: item.name,
      slot: item.slot,
      category: item.category,
      humanityCost: item.humanityCost,
      iconic: item.iconic,
      armor: item.armor,
      accelerator: item.accelerator,
      ...(side ? { armSide: side } : {}),
      ...(item.defaultArmSide ? { defaultArmSide: item.defaultArmSide } : {}),
      ...(item.capacityBonus !== undefined ? { capacityBonus: item.capacityBonus } : {}),
      ...(item.safeLineBonus !== undefined ? { safeLineBonus: item.safeLineBonus } : {}),
      ...(item.chassisProfile ? { chassisProfile: item.chassisProfile } : {}),
      ...(item.deckProfile ? { deckProfile: item.deckProfile } : {}),
      ...(item.deckTraits ? { deckTraits: item.deckTraits } : {}),
      ...(item.exclusiveGroup ? { exclusiveGroup: item.exclusiveGroup } : {}),
    };
    const conflict = cyberwareRules.cyberwareConflicts(probe, activeInstalledProbes);
    const replaceBlocker = !conflict.ok ? (conflict.blockers[0] ?? null) : null;
    const replaceId = replaceBlocker?.id ?? item.replacesId ?? undefined;
    const replaceName = replaceBlocker?.name ?? item.replaces ?? undefined;
    const check = cyberwareRules.checkCyberwareInstall(probe, activeInstalledProbes, {
      ignoreIds: replaceId ? [item.id, replaceId] : [item.id],
    });
    return { side, replaceId, replaceName, check };
  };

  const creditFrozen = Boolean(doc.debt?.overdue);
  const availableCredit = creditFrozen ? 0 : Math.max(0, doc.credit - (doc.debt?.amount ?? 0));
  const creditable = (item: ShelfItem) =>
    !creditFrozen && availableCredit > 0 && item.net - eddies <= availableCredit;
  const shortReason = creditFrozen
    ? "存在逾期欠款，须先还清才能继续赊账"
    : doc.credit > 0
      ? "欧元和剩余可赊额度不足"
      : "欧元不够";
  const owed = confirming ? Math.max(0, confirming.item.net - eddies) : 0;

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

  const equippedByCat = useMemo(() => {
    const counts = new Map<CategoryId, number>();
    for (const part of view.cyberware) {
      counts.set(part.category, (counts.get(part.category) ?? 0) + 1);
    }
    return counts;
  }, [view.cyberware]);

  const shelfByCatCount = useMemo(() => {
    const counts = new Map<CategoryId, number>();
    for (const item of doc.shelf) {
      counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
    }
    return counts;
  }, [doc.shelf]);

  const filteredInstalled = useMemo(() => {
    return view.cyberware.filter((c) => {
      if (catFilter !== "all" && catFilter !== "installed" && c.category !== catFilter) {
        return false;
      }
      if (rarityFilter !== "all" && c.rarity !== rarityFilter) return false;
      if (!normalizedQuery) return true;
      return `${c.name} ${c.categoryLabel} ${c.ability ?? ""}`
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [view.cyberware, catFilter, rarityFilter, normalizedQuery]);

  const filteredShelf = useMemo(() => {
    if (catFilter === "installed") return [];
    return doc.shelf.filter((item) => {
      if (catFilter !== "all" && item.category !== catFilter) return false;
      if (rarityFilter !== "all" && item.rarity !== rarityFilter) return false;
      if (onlyInStock && item.inStock <= 0) return false;
      if (onlyAffordable && item.net > eddies + availableCredit) return false;
      if (!normalizedQuery) return true;
      return `${item.name} ${item.categoryLabel} ${item.ability}`
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [
    doc.shelf,
    catFilter,
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

  const groupedShelf = groupShelfByCategory(filteredShelf);

  const foldShelfItems = (items: readonly ShelfItem[]) =>
    cyberwareRules.foldCyberwareVariants(items, {
      disabled: normalizedQuery.length > 0,
      chosen: variantChoice,
      isPreferred: (item) => item.installed,
    });

  const renderInspector = () => {
    if (inspectedShelf) {
      const item = inspectedShelf;
      const art = itemArtOf(item.id);
      const rarityTint = rarityTintOf(item.rarity, item.iconic);
      const rarityLabel = rarityLabelOf(item.rarity, item.iconic);
      const short = item.net > eddies;
      const credit = short && creditable(item);
      const isArm = item.category === "arms";
      const { side, replaceId, replaceName, check } = evaluateShelfInstall(
        item,
        isArm ? selectedArmSide : undefined,
      );
      const afterLoad = check.ok ? check.nextLoad : (check.nextLoad ?? null);
      const effectiveLock = item.locked ?? (!check.ok ? check.reason : null);
      const itemLoad = cyberwareRules.effectiveCyberwareLoad(
        {
          id: item.id,
          slot: item.slot,
          humanityCost: item.humanityCost,
          category: item.category,
          ...(item.exclusiveGroup ? { exclusiveGroup: item.exclusiveGroup } : {}),
          ...(side ? { armSide: side } : {}),
        },
        side,
      );

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
            <p className={rip.inspectorSub} data-tone={effectiveLock ? "bad" : undefined}>
              {[
                rarityLabel,
                item.categoryLabel,
                itemLoad > 0 ? `承载 ${itemLoad}` : null,
                item.installed ? "已装备" : null,
                effectiveLock
                  ? "不可手术"
                  : item.inStock > 0
                    ? `现货 ${item.inStock} 件`
                    : "无现货",
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>

          <p className={rip.inspectorAbility}>{item.ability}</p>

          {isArm && !item.installed && (
            <fieldset className={rip.armChoiceBar} aria-label="选择手臂手术侧别">
              <span>手术侧别</span>
              {(["left", "right", "both"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  className={rip.variantPill}
                  data-active={selectedArmSide === s || undefined}
                  onClick={() => setSelectedArmSide(s)}
                >
                  {cyberwareRules.ARM_SIDE_LABELS[s]}
                  {s === "both" ? " (100%)" : " (60%)"}
                </button>
              ))}
            </fieldset>
          )}

          <div className={rip.impactList}>
            <div className={rip.impactRow}>
              <span>装配方式</span>
              <strong data-tone={replaceName ? undefined : "cyan"}>
                {replaceName
                  ? `换下旧件 · ${replaceName}`
                  : isArm && side
                    ? `直接加装 · ${cyberwareRules.ARM_SIDE_LABELS[side]}`
                    : "直接加装"}
              </strong>
            </div>
            {afterLoad && !item.installed && (
              <div className={rip.impactRow}>
                <span>术后承载</span>
                <strong
                  data-tone={
                    afterLoad.activeLoadScore > afterLoad.hardCap
                      ? "bad"
                      : afterLoad.overloaded
                        ? undefined
                        : "cyan"
                  }
                >
                  {currentLoad.activeLoadScore} → {afterLoad.activeLoadScore} / {afterLoad.hardCap}
                  （{afterLoad.label}）
                </strong>
              </div>
            )}
            <div className={rip.impactRow}>
              <span>手术报价</span>
              <strong>{money(item.price)} 欧元</strong>
            </div>
            {item.tradeIn > 0 && replaceName && (
              <div className={rip.impactRow}>
                <span>旧件折抵 · {replaceName}</span>
                <strong data-tone="cyan">折抵 −{money(item.tradeIn)} 欧元</strong>
              </div>
            )}
            <div className={rip.impactRow}>
              <span>实际应付</span>
              <strong data-tone={short && !credit ? "bad" : credit ? "cyan" : undefined}>
                {money(item.net)} 欧元{credit ? `（需赊 ${money(item.net - eddies)}）` : ""}
              </strong>
            </div>
            {afterLoad?.overloaded && check.ok && (
              <p className={rip.impactWarn}>
                术后将进入超载红线（
                {afterLoad.alertReason ?? `${afterLoad.activeLoadScore}/${afterLoad.hardCap}`}
                ），高强度行动或断药时可能诱发排异症状。
              </p>
            )}
            {effectiveLock && <p className={rip.impactWarn}>{effectiveLock}</p>}
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
                disabled={!onBuy || working || effectiveLock !== null || (short && !credit)}
                reason={effectiveLock ?? (short && !credit ? shortReason : undefined)}
                onClick={() =>
                  setConfirming({
                    item,
                    ...(side ? { armSide: side } : {}),
                    ...(replaceId ? { replace: replaceId } : {}),
                    ...(replaceName ? { replaceName } : {}),
                  })
                }
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
              {[
                rarityLabel,
                part.categoryLabel,
                part.armSideLabel,
                part.broken ? "已损毁 · 待修" : "正常运行",
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>

          {part.ability && <p className={rip.inspectorAbility}>{part.ability}</p>}

          <div className={rip.impactList}>
            {part.effectiveLoad > 0 && (
              <div className={rip.impactRow}>
                <span>占用神经承载</span>
                <strong>{part.effectiveLoad}</strong>
              </div>
            )}
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
            <header className={rip.clinicTop}>
              <div className={rip.docProfile}>
                <div className={rip.docAvatarBox}>
                  <CellFrame />
                  {(() => {
                    const docPortrait = portraitOf(doc.keeperNpc ?? doc.id);
                    return docPortrait ? (
                      <Asset
                        id={docPortrait}
                        height={56}
                        alt={doc.name}
                        className={rip.docPortrait}
                      />
                    ) : (
                      <Asset id="map.poi.ripperdoc" height={28} tint="var(--cp-cyan)" />
                    );
                  })()}
                </div>
                <div className={rip.docMeta}>
                  <p
                    className={rip.docMetaLine}
                    data-warn={
                      doc.blackMarket ||
                      doc.mood?.factor === null ||
                      (doc.mood?.factor !== undefined && doc.mood.factor > 1) ||
                      undefined
                    }
                  >
                    {[
                      doc.blackMarket ? "黑市货源 · −20%（无保修）" : "认证诊所",
                      doc.mood ? doc.mood.label : null,
                      doc.credit > 0
                        ? creditFrozen
                          ? "逾期冻结赊账"
                          : `剩余可赊 ${money(availableCredit)} 欧元`
                        : null,
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
                  神经：{view.humanity.stageLabel}
                </span>
                {brokenCount > 0 && <span data-tone="bad">损毁 {brokenCount}</span>}
                <Button small onClick={onClose}>
                  离开
                </Button>
              </div>
            </header>

            <NeuralLoadBar load={currentLoad} />

            {doc.mood?.lock && (
              <div className={rip.debtBanner} role="alert">
                <CellFrame />
                <Asset id="notify.warning" height={18} tint="var(--cp-red)" />
                <span className={rip.debtText}>{doc.mood.lock}</span>
              </div>
            )}

            {doc.debt && (
              <div className={rip.debtBanner} role="status">
                <CellFrame />
                <Asset id="notify.warning" height={18} tint="var(--cp-red)" />
                <span className={rip.debtText}>
                  欠 {doc.name} <b>{money(doc.debt.amount)}</b> 欧元，
                  {doc.debt.overdue
                    ? `已逾期（原期限：${doc.debt.due}），须先还清才能继续赊账`
                    : doc.debt.due === "未约定期限"
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

            {view.money.chromeCare && (
              <div className={rip.debtBanner} role="status">
                <CellFrame />
                <Asset
                  id={view.money.chromeCare.overdue ? "notify.warning" : "map.poi.ripperdoc"}
                  height={18}
                  tint={view.money.chromeCare.overdue ? "var(--cp-red)" : "var(--cp-cyan)"}
                />
                <span className={rip.debtText}>
                  {view.money.chromeCare.label}：
                  {view.money.chromeCare.overdue
                    ? "已逾期，高压义体接口易排异发抖"
                    : view.money.chromeCare.calibrated
                      ? `已校准，距下次校准还有 ${view.money.chromeCare.daysLeft} 天`
                      : `尚未校准，距本期维护到期还有 ${view.money.chromeCare.daysLeft} 天`}
                  （诊所报价 <b>{money(chromeCareCost)}</b> 欧元，校准后稳固 14 天）
                </span>
                <Button
                  small
                  primary={view.money.chromeCare.overdue || view.money.chromeCare.dueSoon}
                  disabled={
                    !onPayChromeCare ||
                    !doc.chromeCare ||
                    working ||
                    Boolean(chromeCareLock) ||
                    eddies < chromeCareCost
                  }
                  reason={chromeCareLock ?? (eddies < chromeCareCost ? "欧元不够" : undefined)}
                  onClick={() => onPayChromeCare && void run(onPayChromeCare)}
                >
                  {working
                    ? "校准中…"
                    : view.money.chromeCare.calibrated && !view.money.chromeCare.dueSoon
                      ? "已校准"
                      : "上椅校准"}
                </Button>
              </div>
            )}

            <nav className={rip.navSection} aria-label="诊所货架筛选">
              <div className={rip.catRows}>
                <div className={rip.catGroup}>
                  <span className={rip.catGroupLabel}>核心主位</span>
                  <div className={rip.catTabs}>
                    <button
                      type="button"
                      className={rip.catTab}
                      aria-pressed={catFilter === "all"}
                      onClick={() => setCatFilter("all")}
                    >
                      全部
                    </button>
                    <button
                      type="button"
                      className={rip.catTab}
                      aria-pressed={catFilter === "installed"}
                      onClick={() => setCatFilter("installed")}
                    >
                      <span>已装</span>
                      <span className={rip.catCount}>{view.cyberware.length}</span>
                    </button>
                    {(
                      [
                        "chassis",
                        "cyberdeck",
                        "spineDrive",
                        "optics",
                        "arms",
                        "legDrive",
                        "skinArmor",
                      ] as const
                    ).map((cat) => {
                      const eq = equippedByCat.get(cat) ?? 0;
                      const shelfN = shelfByCatCount.get(cat) ?? 0;
                      if (eq === 0 && shelfN === 0) return null;
                      return (
                        <button
                          key={cat}
                          type="button"
                          className={rip.catTab}
                          aria-pressed={catFilter === cat}
                          onClick={() => setCatFilter(cat)}
                        >
                          <span>{CATEGORY_LABELS[cat]}</span>
                          {eq > 0 && <span className={rip.catCount}>{eq}</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className={rip.catGroup}>
                  <span className={rip.catGroupLabel}>扩展与外观</span>
                  <div className={rip.catTabs}>
                    {cyberwareRules.EXTENSION_ZONE_IDS.map((zone) => {
                      const eq = equippedByCat.get(zone) ?? 0;
                      const shelfN = shelfByCatCount.get(zone) ?? 0;
                      if (eq === 0 && shelfN === 0) return null;
                      const limit = currentLoad.zoneLimits[zone];
                      return (
                        <button
                          key={zone}
                          type="button"
                          className={rip.catTab}
                          aria-pressed={catFilter === zone}
                          onClick={() => setCatFilter(zone)}
                        >
                          <span>{CATEGORY_LABELS[zone]}</span>
                          <span className={rip.catCount}>
                            {limit === null ? eq : `${eq}/${limit}`}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className={rip.filterRow}>
                {catFilter !== "installed" && companions.length > 0 && (
                  <div className={rip.rarityRow} style={{ marginRight: 8 }}>
                    <button
                      type="button"
                      className={rip.filterChip}
                      aria-pressed={!targetCompanion}
                      onClick={() => setInstallForNpcId("")}
                    >
                      给自己装
                    </button>
                    {companions.map((comp) => (
                      <button
                        key={comp.id}
                        type="button"
                        className={rip.filterChip}
                        aria-pressed={targetCompanion?.id === comp.id}
                        onClick={() => setInstallForNpcId(comp.id)}
                      >
                        给 {comp.name} 装
                      </button>
                    ))}
                  </div>
                )}
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
                  {catFilter !== "installed" && (
                    <>
                      <button
                        type="button"
                        className={rip.filterChip}
                        aria-pressed={onlyInStock}
                        onClick={() => setOnlyInStock((v) => !v)}
                      >
                        仅看现货
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
                    placeholder="检索义体名称 / 定位 / 效果…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
              </div>
            </nav>

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
                                size={42}
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
                                  {[
                                    rarityLabel,
                                    c.categoryLabel,
                                    c.armSideLabel,
                                    c.effectiveLoad > 0 ? `承载 ${c.effectiveLoad}` : null,
                                  ]
                                    .filter(Boolean)
                                    .join(" · ")}
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

                {catFilter !== "installed" &&
                  (groupedShelf.length === 0 ? (
                    <div className={rip.emptyState}>
                      当前筛选条件在{doc.name}的货架里没有匹配的义体。
                    </div>
                  ) : (
                    groupedShelf.map(([cat, label, items]) => {
                      const rows = foldShelfItems(items);
                      return (
                        <section key={cat} className={rip.groupSection}>
                          <h3 className={rip.groupTitle}>{label}</h3>
                          <ul className={rip.cardList}>
                            {rows.map(({ active: item, groupId, variants }) => {
                              const isSelected = inspectedShelf?.id === item.id;
                              const rarityTint = rarityTintOf(item.rarity, item.iconic);
                              const short = item.net > eddies;
                              const credit = short && creditable(item);
                              const isArm = item.category === "arms";
                              const { side, replaceId, replaceName, check } = evaluateShelfInstall(
                                item,
                                isArm ? selectedArmSide : undefined,
                              );
                              const lockMsg = item.locked ?? (!check.ok ? check.reason : null);
                              return (
                                <li
                                  key={groupId ?? item.id}
                                  className={rip.card}
                                  data-selected={isSelected || undefined}
                                  data-locked={lockMsg !== null || undefined}
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
                                      size={44}
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
                                          item.humanityCost > 0
                                            ? `承载 ${item.humanityCost}`
                                            : null,
                                          item.inStock > 0 ? `现货 ${item.inStock}` : "缺货",
                                          replaceName ? `换下 ${replaceName}` : null,
                                        ]
                                          .filter(Boolean)
                                          .join(" · ")}
                                      </span>
                                      {lockMsg && <p className={rip.lockNote}>{lockMsg}</p>}
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
                                      {item.tradeIn > 0 && replaceName && (
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
                                          lockMsg !== null ||
                                          (short && !credit)
                                        }
                                        reason={
                                          lockMsg ?? (short && !credit ? shortReason : undefined)
                                        }
                                        onClick={() =>
                                          setConfirming({
                                            item,
                                            ...(side ? { armSide: side } : {}),
                                            ...(replaceId ? { replace: replaceId } : {}),
                                            ...(replaceName ? { replaceName } : {}),
                                          })
                                        }
                                      >
                                        {credit ? "赊账装上" : "装上"}
                                      </Button>
                                    )}
                                  </div>
                                  {groupId && variants && (
                                    <fieldset
                                      className={rip.variantRow}
                                      aria-label={`${item.name}元素变体`}
                                    >
                                      {variants.map((v) => (
                                        <button
                                          key={v.key}
                                          type="button"
                                          className={rip.variantPill}
                                          data-active={v.item.id === item.id || undefined}
                                          onClick={() => {
                                            setVariantChoice((prev) => ({
                                              ...prev,
                                              [groupId]: v.key,
                                            }));
                                            setFocus({ kind: "shelf", id: v.item.id });
                                          }}
                                        >
                                          {cyberwareRules.ELEMENT_VARIANT_LABELS[v.key]}
                                        </button>
                                      ))}
                                    </fieldset>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        </section>
                      );
                    })
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
          title={
            targetCompanion
              ? `为同行同伴 ${targetCompanion.name} 安装${confirming.item.name}？`
              : `装上${confirming.item.name}？`
          }
          tone="info"
          onClose={() => setConfirming(null)}
          actions={
            <>
              <Button
                primary
                disabled={
                  working ||
                  !onBuy ||
                  confirming.item.locked !== null ||
                  (targetCompanion
                    ? eddies < confirming.item.price
                    : owed > 0 && !creditable(confirming.item))
                }
                onClick={() =>
                  onBuy &&
                  void run(() =>
                    targetCompanion
                      ? onBuy(confirming.item.id, false, { forNpc: targetCompanion.id })
                      : onBuy(confirming.item.id, owed > 0, {
                          ...(confirming.armSide ? { armSide: confirming.armSide } : {}),
                          ...(confirming.replace ? { replace: confirming.replace } : {}),
                        }),
                  )
                }
              >
                {working
                  ? "装着呢…"
                  : targetCompanion
                    ? `付 ${money(confirming.item.price)} 欧元给 ${targetCompanion.name} 装`
                    : owed > 0
                      ? `付 ${money(eddies)}，赊 ${money(owed)}`
                      : `付 ${money(confirming.item.net)} 欧元`}
              </Button>
              <Button onClick={() => setConfirming(null)}>再想想</Button>
            </>
          }
        >
          <p>
            {confirming.item.categoryLabel}
            {confirming.armSide ? ` · ${cyberwareRules.ARM_SIDE_LABELS[confirming.armSide]}` : ""} ·{" "}
            {rarityLabelOf(confirming.item.rarity, confirming.item.iconic)}
          </p>
          <p>{confirming.item.ability}</p>
          {confirming.replaceName && (
            <p>
              换下旧件：{confirming.replaceName}（折抵 {money(confirming.item.tradeIn)} 欧元）
            </p>
          )}
          {owed > 0 && (
            <p>
              将向 {doc.name} 赊账 {money(owed)} 欧元
              {doc.creditDays ? `，约定 ${doc.creditDays} 天内归还` : ""}。
            </p>
          )}
        </Dialog>
      )}
    </div>
  );
}
