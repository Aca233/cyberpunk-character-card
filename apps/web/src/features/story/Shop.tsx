import type { inventoryRules } from "@cp/core";
import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { AssetId } from "../../assets";
import { Asset, cssUrl } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { CellFrame } from "../../ui/FrameBox";
import { useLayer } from "../../ui/layers";
import { Panel } from "../../ui/Panel";
import { useCardTilt } from "../../ui/useCardTilt";
import { baseWeaponIdOf, itemArtOf, portraitOf, shopPoiIconOf, weaponHudIconOf } from "./art";
import { RARITY_ORDER, rarityLabelOf, rarityTintOf } from "./cyberwareMeta";
import shopCss from "./shop.module.css";
import {
  CONCEALMENT_LABELS,
  NOISE_LABELS,
  summarizeWeaponState,
  type View,
  type WeaponConcealment,
  type WeaponNoise,
  type WeaponStateSummary,
} from "./view";

type ShopView = View["shops"][number];
type ShelfItem = ShopView["shelf"][number];
type SaleItem = ShopView["sell"][number];
type GunsmithView = NonNullable<ShopView["gunsmith"]>;
type GunsmithWeapon = GunsmithView["weapons"][number];
type GunsmithPayload = Omit<inventoryRules.GunsmithAction, "type" | "shop">;
type ShopMode = "buy" | "sell" | "gunsmith";
type SortMode = "default" | "priceAsc" | "priceDesc" | "rarityDesc";
type ViewLayout = "grid" | "list";

interface GunsmithPreview {
  readonly concealment: WeaponConcealment;
  readonly noise: WeaponNoise;
  readonly smartLink: boolean;
}

interface GunsmithConfirm {
  readonly kind: "gunsmith";
  readonly weapon: GunsmithWeapon;
  readonly title: string;
  readonly description: string;
  readonly payload: GunsmithPayload;
  readonly partsFee: number;
  readonly serviceFee: number;
  readonly total: number;
  readonly preview: GunsmithPreview;
}

const CONCEAL_ORDER: readonly WeaponConcealment[] = ["pocket", "coat", "open", "heavy"];

const SHOP_KIND_KICKER: Readonly<Record<string, string>> = {
  gun: "WEAPON VENDOR // 军火商贩终端",
  melee: "MELEE VENDOR // 近战兵器柜台",
  clothes: "APPAREL VENDOR // 街头服饰终端",
  meds: "MEDPOINT // 药物与医疗补给",
  food: "STREET FOOD // 街头食肆柜台",
  bar: "NIGHTLIFE // 酒吧与调制柜台",
  junk: "PAWN & JUNK // 杂货与旧货摊",
  netrunner: "NETRUNNER // 芯片与协议终端",
  ripperdoc: "CLINIC // 义体配件柜台",
};

const SORT_LABELS: Readonly<Record<SortMode, string>> = {
  default: "品类分组",
  priceAsc: "价格从低到高",
  priceDesc: "价格从高到低",
  rarityDesc: "稀有度从高到低",
};

const RARITY_RANK: Readonly<Record<string, number>> = {
  common: 1,
  uncommon: 2,
  rare: 3,
  epic: 4,
  legendary: 5,
};

function rarityScore(rarity: string | null, iconic: boolean): number {
  const base = rarity ? (RARITY_RANK[rarity] ?? 0) : 0;
  return iconic ? base + 10 : base;
}

function modConcealmentShift(modId: string, slot: inventoryRules.ModSlot): number {
  if (slot === "muzzle") return 1;
  if (modId === "saika-scope" || modId === "gaki-scope") return 1;
  return 0;
}

function baseConcealmentRank(weapon: GunsmithWeapon, currentRank: number): number {
  const { subLabel } = weapon;
  if (subLabel.includes("狙击步枪") || subLabel.includes("轻机枪")) return 3;
  if (
    subLabel.includes("突击步枪") ||
    subLabel.includes("霰弹枪") ||
    subLabel.includes("精准步枪")
  ) {
    return 2;
  }
  if (subLabel.includes("左轮手枪") || subLabel.includes("冲锋枪")) return 1;
  if (subLabel.includes("手枪")) return 0;
  return currentRank;
}

function previewGunsmithImpact(
  weapon: GunsmithWeapon,
  payload: GunsmithPayload,
  slot?: inventoryRules.ModSlot,
): GunsmithPreview {
  const currentRank = CONCEAL_ORDER.indexOf(weapon.concealment);
  const baseRank = baseConcealmentRank(weapon, currentRank);
  const maxRank = baseRank === 3 ? 3 : 2;
  let nextConceal = weapon.concealment;
  let nextNoise = weapon.noise;
  let nextSmartLink = weapon.grantsSmartLink;

  if ((payload.action === "install" || payload.action === "detach") && payload.mod && slot) {
    const afterMods: Partial<Record<inventoryRules.ModSlot, string>> = {
      ...(weapon.weaponState?.mods ?? {}),
    };
    if (payload.action === "install") {
      afterMods[slot] = payload.mod;
      if (slot === "muzzle") nextNoise = "silent";
      if (payload.mod === "smart-link-module") nextSmartLink = true;
    } else {
      Reflect.deleteProperty(afterMods, slot);
      if (slot === "muzzle") nextNoise = "loud";
      if (payload.mod === "smart-link-module" && !weapon.weaponState?.smartLink) {
        nextSmartLink = false;
      }
    }
    let totalShift = 0;
    for (const [s, modId] of Object.entries(afterMods)) {
      if (modId) totalShift += modConcealmentShift(modId, s as inventoryRules.ModSlot);
    }
    const nextRank = Math.max(baseRank, Math.min(maxRank, baseRank + totalShift));
    nextConceal = CONCEAL_ORDER[nextRank] ?? weapon.concealment;
  } else if (payload.action === "convert" && payload.conversion === "smart-link") {
    nextSmartLink = true;
  }

  return {
    concealment: nextConceal,
    noise: nextNoise,
    smartLink: nextSmartLink,
  };
}

const CARD_FOCUS_BTN_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flex: "1 1 12rem",
  minWidth: 0,
  padding: 0,
  border: 0,
  background: "transparent",
  color: "inherit",
  font: "inherit",
  textAlign: "left",
  cursor: "inherit",
};

/** 按品类分组，保持原列表顺序 */
function byGroup<T extends { readonly group: string }>(items: readonly T[]): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const list = groups.get(item.group);
    if (list) list.push(item);
    else groups.set(item.group, [item]);
  }
  return [...groups];
}

function money(n: number): string {
  return n.toLocaleString("en-US");
}

function sellPriceLabel(item: { readonly value: number; readonly locked: string | null }): string {
  if (item.value > 0) return `+${money(item.value)} €`;
  return item.locked !== null ? "暂不可售" : "不收";
}

function matchesRarity(
  item: { readonly rarity: string | null; readonly iconic: boolean },
  filter: string,
): boolean {
  if (filter === "all") return true;
  if (filter === "iconic") return item.iconic;
  return item.rarity === filter;
}

function matchesQuery(
  item: {
    readonly name: string;
    readonly group: string;
    readonly subLabel: string;
    readonly rarityLabel: string | null;
    readonly ability: string | null;
  },
  q: string,
): boolean {
  if (!q) return true;
  return `${item.name} ${item.group} ${item.subLabel} ${item.rarityLabel ?? ""} ${item.ability ?? ""}`
    .toLowerCase()
    .includes(q);
}

function resolveArtOrIcon(
  id: string,
  baseId: string | undefined,
  kind: string | undefined,
  subLabel: string,
  fallbackIcon: AssetId,
): { readonly asset: AssetId; readonly isArtwork: boolean } {
  const art = itemArtOf(baseId ?? id);
  if (art) return { asset: art, isArtwork: true };
  if (kind === "weapon") {
    return { asset: weaponHudIconOf(baseId ?? id, subLabel), isArtwork: false };
  }
  return { asset: fallbackIcon, isArtwork: false };
}

function ShowcaseStage({
  asset,
  isArtwork,
  alt,
  rarityTint,
  rarityText,
  cornerBadge,
}: {
  readonly asset: AssetId;
  readonly isArtwork: boolean;
  readonly alt: string;
  readonly rarityTint: string;
  readonly rarityText: string | null;
  readonly cornerBadge?: ReactNode;
}) {
  const tilt = useCardTilt<HTMLDivElement>({ maxRotate: 5.5, shadowShift: 4 });

  return (
    <div className={shopCss.inspectShowcase} {...tilt}>
      <CellFrame />
      <span
        className={shopCss.inspectGrid}
        style={{ backgroundImage: cssUrl("fx.grid") }}
        aria-hidden
      />
      <span
        className={shopCss.inspectScanlines}
        style={{ backgroundImage: cssUrl("fx.scanlines") }}
        aria-hidden
      />
      <span className={shopCss.inspectGlare} aria-hidden />
      <div className={shopCss.inspectStageTop}>
        {rarityText ? <span className={shopCss.gridRarityTag}>{rarityText}</span> : <span />}
        {cornerBadge}
      </div>
      {isArtwork ? (
        <Asset id={asset} alt={alt} className={shopCss.inspectArt} />
      ) : (
        <Asset id={asset} height={54} tint={rarityTint} className={shopCss.inspectArt} />
      )}
      <span className={shopCss.inspectStageCode} aria-hidden>
        <Asset id="fluff.code" height={12} tint={rarityTint} />
      </span>
    </div>
  );
}

function ShopCatalogCard({
  layout,
  id,
  baseId,
  kind,
  name,
  group,
  subLabel,
  rarity,
  rarityLabel,
  iconic,
  bulky,
  selected,
  locked,
  statusText,
  weaponSummary,
  pills,
  fallbackIcon,
  priceText,
  priceTone,
  actionLabel,
  actionDisabled,
  actionReason,
  onFocus,
  onAction,
}: {
  readonly layout: ViewLayout;
  readonly id: string;
  readonly baseId?: string | undefined;
  readonly kind?: string | undefined;
  readonly name: string;
  readonly group: string;
  readonly subLabel: string;
  readonly rarity: string | null;
  readonly rarityLabel: string | null;
  readonly iconic: boolean;
  readonly bulky: boolean;
  readonly selected: boolean;
  readonly locked: boolean;
  readonly statusText?: string | null;
  readonly weaponSummary?: WeaponStateSummary | null | undefined;
  readonly pills?: ReactNode;
  readonly fallbackIcon: AssetId;
  readonly priceText: string;
  readonly priceTone?: "short" | "sell" | "bad";
  readonly actionLabel: string;
  readonly actionDisabled: boolean;
  readonly actionReason?: string | undefined;
  readonly onFocus: () => void;
  readonly onAction: () => void;
}) {
  const rarityTint = rarityTintOf(rarity, iconic);
  const rarityText = rarityLabelOf(rarity, iconic) ?? rarityLabel;
  const visual = resolveArtOrIcon(id, baseId, kind, subLabel, fallbackIcon);
  const metaText = [
    subLabel && subLabel !== group ? subLabel : group,
    bulky ? "占手" : null,
    statusText,
  ]
    .filter(Boolean)
    .join(" · ");

  if (layout === "grid") {
    return (
      <li
        className={shopCss.gridCard}
        data-selected={selected || undefined}
        data-locked={locked || undefined}
        style={{ "--item-tint": rarityTint } as CSSProperties}
      >
        <CellFrame />
        <button type="button" className={shopCss.gridFocusBtn} onClick={onFocus}>
          <span className={shopCss.gridStage} aria-hidden>
            <span
              className={shopCss.gridStageGrid}
              style={{ backgroundImage: cssUrl("fx.grid") }}
            />
            <span className={shopCss.gridStageTop}>
              {rarityText ? <span className={shopCss.gridRarityTag}>{rarityText}</span> : <span />}
              <span className={shopCss.gridCornerPills}>{pills}</span>
            </span>
            {visual.isArtwork ? (
              <Asset id={visual.asset} alt={name} className={shopCss.gridArt} />
            ) : (
              <Asset id={visual.asset} height={32} tint={rarityTint} className={shopCss.gridArt} />
            )}
          </span>

          <span className={shopCss.gridInfo}>
            <span className={shopCss.gridNameRow}>
              <strong className={shopCss.gridName} title={name}>
                {name}
              </strong>
              {weaponSummary && weaponSummary.mods.length > 0 && (
                <span className={shopCss.ownedPill}>{weaponSummary.mods.length}改</span>
              )}
              {weaponSummary?.smartLink && <span className={shopCss.ownedPill}>联锁</span>}
            </span>
            <span className={shopCss.gridMeta} title={weaponSummary?.inlineText ?? metaText}>
              {weaponSummary?.inlineText ? `${metaText} · ${weaponSummary.inlineText}` : metaText}
            </span>
          </span>
        </button>

        <div className={shopCss.gridFooter}>
          <span
            className={shopCss.priceTag}
            data-short={priceTone === "short" || undefined}
            data-sell={priceTone === "sell" || undefined}
            data-tone={priceTone === "bad" ? "bad" : priceTone === "sell" ? "cyan" : undefined}
          >
            {priceText}
          </span>
          <Button small disabled={actionDisabled} reason={actionReason} onClick={onAction}>
            {actionLabel}
          </Button>
        </div>
      </li>
    );
  }

  const listMetaText = [
    rarityText,
    subLabel && subLabel !== group ? subLabel : null,
    bulky ? "占手" : null,
    statusText,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li
      className={shopCss.itemCard}
      data-selected={selected || undefined}
      data-locked={locked || undefined}
      style={{ "--item-tint": rarityTint } as CSSProperties}
    >
      <CellFrame />
      <button type="button" style={CARD_FOCUS_BTN_STYLE} onClick={onFocus}>
        <span className={shopCss.thumbBox} aria-hidden>
          {visual.isArtwork ? (
            <Asset id={visual.asset} alt={name} className={shopCss.thumbImg} />
          ) : (
            <Asset id={visual.asset} height={26} tint={rarityTint} className={shopCss.thumbImg} />
          )}
        </span>

        <span className={shopCss.itemBody}>
          <span className={shopCss.itemTitleRow}>
            <strong className={shopCss.itemName}>{name}</strong>
            {pills}
            {weaponSummary && weaponSummary.mods.length > 0 && (
              <span className={shopCss.ownedPill}>已装 {weaponSummary.mods.length} 改</span>
            )}
            {weaponSummary?.smartLink && <span className={shopCss.ownedPill}>智能联锁</span>}
          </span>
          {listMetaText && <span className={shopCss.itemMeta}>{listMetaText}</span>}
          {weaponSummary?.inlineText && (
            <span className={shopCss.itemModLine}>{weaponSummary.inlineText}</span>
          )}
        </span>
      </button>

      <div className={shopCss.itemAside}>
        <span
          className={shopCss.priceTag}
          data-short={priceTone === "short" || undefined}
          data-sell={priceTone === "sell" || undefined}
          data-tone={priceTone === "bad" ? "bad" : priceTone === "sell" ? "cyan" : undefined}
        >
          {priceText}
        </span>
        <Button small disabled={actionDisabled} reason={actionReason} onClick={onAction}>
          {actionLabel}
        </Button>
      </div>
    </li>
  );
}

interface InspectorMetaRow {
  readonly label: string;
  readonly value: string;
  readonly tone?: "yellow" | "cyan" | "bad";
}

function ShopInspector({
  mode,
  id,
  baseId,
  kind,
  name,
  group,
  subLabel,
  rarity,
  rarityLabel,
  iconic,
  bulky,
  chargesText,
  healPercent,
  ability,
  weaponSummary,
  fallbackIcon,
  stageBadge,
  primaryLabel,
  primaryValue,
  primaryTone,
  rows,
  alert,
  actionLabel,
  actionDisabled,
  actionReason,
  onAction,
}: {
  readonly mode: "buy" | "sell";
  readonly id: string;
  readonly baseId?: string | undefined;
  readonly kind?: string | undefined;
  readonly name: string;
  readonly group: string;
  readonly subLabel: string;
  readonly rarity: string | null;
  readonly rarityLabel: string | null;
  readonly iconic: boolean;
  readonly bulky: boolean;
  readonly chargesText: string | null;
  readonly healPercent: number | null;
  readonly ability: string | null;
  readonly weaponSummary?: WeaponStateSummary | null | undefined;
  readonly fallbackIcon: AssetId;
  readonly stageBadge?: ReactNode;
  readonly primaryLabel: string;
  readonly primaryValue: string;
  readonly primaryTone?: "yellow" | "cyan" | "bad";
  readonly rows: readonly InspectorMetaRow[];
  readonly alert: string | null;
  readonly actionLabel: string;
  readonly actionDisabled: boolean;
  readonly actionReason?: string | undefined;
  readonly onAction: () => void;
}) {
  const rarityTint = rarityTintOf(rarity, iconic);
  const rarityText = rarityLabelOf(rarity, iconic) ?? rarityLabel;
  const visual = resolveArtOrIcon(id, baseId, kind, subLabel, fallbackIcon);

  return (
    <aside
      className={shopCss.inspector}
      data-split="true"
      aria-label="商品详情检视"
      style={{ "--item-tint": rarityTint } as CSSProperties}
    >
      <CellFrame />
      <div className={shopCss.inspectScroll}>
        <ShowcaseStage
          asset={visual.asset}
          isArtwork={visual.isArtwork}
          alt={name}
          rarityTint={rarityTint}
          rarityText={rarityText}
          cornerBadge={stageBadge}
        />

        <div className={shopCss.inspectHeader}>
          <h3>{name}</h3>
          <p>{subLabel || group}</p>
        </div>

        <div className={shopCss.inspectTags}>
          <span className={shopCss.inspectTag}>{group}</span>
          {subLabel && subLabel !== group && <span className={shopCss.inspectTag}>{subLabel}</span>}
          {rarityText && (
            <span
              className={shopCss.inspectTag}
              data-rarity={rarity ?? (iconic ? "iconic" : undefined)}
              data-tone="rarity"
            >
              {rarityText}
            </span>
          )}
          {bulky && (
            <span className={shopCss.inspectTag} data-tone="yellow">
              占手大件
            </span>
          )}
          {chargesText && <span className={shopCss.inspectTag}>{chargesText}</span>}
          {healPercent !== null && (
            <span className={shopCss.inspectTag}>回复 {healPercent}% 生命</span>
          )}
        </div>

        {ability && <p className={shopCss.inspectAbility}>{ability}</p>}

        {weaponSummary && (
          <div className={shopCss.inspectWeaponState}>
            <span className={shopCss.inspectWeaponTitle}>{"WEAPON CONFIG // 随枪改装"}</span>
            {weaponSummary.smartLink && (
              <div className={shopCss.inspectMetaRow}>
                <span>结构改造</span>
                <strong data-tone="cyan">智能靶向联锁</strong>
              </div>
            )}
            {weaponSummary.mods.map((m) => (
              <div key={m.slot} className={shopCss.inspectMetaRow}>
                <span>{m.slotLabel}改装</span>
                <strong>
                  {m.modName}
                  {m.locked ? "（固锁）" : ""}
                </strong>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={shopCss.inspectFooter}>
        <div
          className={shopCss.ledgerCard}
          data-mode={mode}
          data-bad={primaryTone === "bad" || undefined}
        >
          <div className={shopCss.ledgerPrimary}>
            <span>{primaryLabel}</span>
            <strong className={shopCss.ledgerPrice} data-tone={primaryTone}>
              {primaryValue}
            </strong>
          </div>
          <div className={shopCss.inspectMetaGrid}>
            {rows.map((row) => (
              <div key={row.label} className={shopCss.inspectMetaRow}>
                <span>{row.label}</span>
                <strong data-tone={row.tone}>{row.value}</strong>
              </div>
            ))}
          </div>
        </div>

        {alert && <p className={shopCss.inspectAlert}>{alert}</p>}

        <div className={shopCss.inspectActions}>
          <Button primary disabled={actionDisabled} reason={actionReason} onClick={onAction}>
            {actionLabel}
          </Button>
        </div>
      </div>
    </aside>
  );
}

function GunsmithInspector({
  weapon,
  eddies,
  working,
  blocked,
  onConfirm,
}: {
  readonly weapon: GunsmithWeapon;
  readonly eddies: number;
  readonly working: boolean;
  readonly blocked: string | null;
  readonly onConfirm: (confirm: GunsmithConfirm) => void;
}) {
  const [hoveredPreview, setHoveredPreview] = useState<GunsmithPreview | null>(null);
  const art = itemArtOf(weapon.baseId ?? weapon.id);
  const hudIcon = weaponHudIconOf(weapon.baseId ?? weapon.id, weapon.subLabel);
  const rarityTint = rarityTintOf(weapon.rarity, weapon.iconic);
  const rarityText = rarityLabelOf(weapon.rarity, weapon.iconic) ?? weapon.rarityLabel;
  const isMelee = weapon.subLabel.includes("刀剑") || weapon.subLabel.includes("钝器");

  const activePreview = hoveredPreview;
  const concealChanged = Boolean(activePreview && activePreview.concealment !== weapon.concealment);
  const noiseChanged = Boolean(activePreview && activePreview.noise !== weapon.noise);
  const smartChanged = Boolean(activePreview && activePreview.smartLink !== weapon.grantsSmartLink);
  const installedCount = weapon.slots.filter((s) => s.installed !== null).length;

  const previewBind = (preview: GunsmithPreview) => ({
    onMouseEnter: () => setHoveredPreview(preview),
    onMouseLeave: () => setHoveredPreview(null),
    onFocus: () => setHoveredPreview(preview),
    onBlur: () => setHoveredPreview(null),
  });

  const smartTotal = weapon.smartLinkConvert.total;
  const smartShort = smartTotal !== null && smartTotal > eddies;
  const smartDisabled =
    working ||
    Boolean(blocked) ||
    !weapon.smartLinkConvert.eligible ||
    weapon.smartLinkConvert.installed ||
    smartTotal === null ||
    Boolean(weapon.smartLinkConvert.locked) ||
    smartShort;
  const smartReason =
    blocked ?? weapon.smartLinkConvert.locked ?? (smartShort ? "欧元不够" : undefined);

  return (
    <aside
      className={shopCss.inspector}
      aria-label="枪匠工坊检视台"
      style={{ "--item-tint": rarityTint } as CSSProperties}
    >
      <CellFrame />
      <ShowcaseStage
        asset={art ?? hudIcon}
        isArtwork={Boolean(art)}
        alt={weapon.name}
        rarityTint={rarityTint}
        rarityText={rarityText}
        cornerBadge={
          <span className={shopCss.ownedPill}>
            槽位 {installedCount}/{weapon.slots.length}
          </span>
        }
      />

      <div className={shopCss.inspectHeader}>
        <h3>{weapon.name}</h3>
        <p>{weapon.subLabel}</p>
      </div>

      <div className={shopCss.gsPreviewBox}>
        <div className={shopCss.gsMetric} data-changed={concealChanged || undefined}>
          <span className={shopCss.gsMetricLabel}>隐蔽携行</span>
          <strong className={shopCss.gsMetricValue}>
            {CONCEALMENT_LABELS[weapon.concealment]}
            {concealChanged && activePreview
              ? ` → ${CONCEALMENT_LABELS[activePreview.concealment]}`
              : ""}
          </strong>
        </div>
        {!isMelee && (
          <div className={shopCss.gsMetric} data-changed={noiseChanged || undefined}>
            <span className={shopCss.gsMetricLabel}>声学特征</span>
            <strong className={shopCss.gsMetricValue}>
              {NOISE_LABELS[weapon.noise]}
              {noiseChanged && activePreview ? ` → ${NOISE_LABELS[activePreview.noise]}` : ""}
            </strong>
          </div>
        )}
        {(weapon.grantsSmartLink || weapon.smartLinkConvert.eligible || smartChanged) && (
          <div className={shopCss.gsMetric} data-changed={smartChanged || undefined}>
            <span className={shopCss.gsMetricLabel}>智能联锁</span>
            <strong className={shopCss.gsMetricValue}>
              {weapon.grantsSmartLink ? "已激活" : "未激活"}
              {smartChanged && activePreview
                ? ` → ${activePreview.smartLink ? "已激活" : "未激活"}`
                : ""}
            </strong>
          </div>
        )}
      </div>

      {blocked && <p className={shopCss.inspectAlert}>{blocked}</p>}

      {weapon.smartLinkConvert.eligible && (
        <section className={shopCss.gsSection} aria-label="结构改造">
          <h4 className={shopCss.gsSectionTitle}>
            <Asset id="interaction.engineering" height={13} tint="var(--cp-yellow)" />
            结构改造
          </h4>
          <div className={shopCss.gsServiceCard}>
            <div className={shopCss.gsServiceInfo}>
              <strong>智能靶向联锁模块</strong>
              <small>
                {weapon.smartLinkConvert.installed
                  ? "当前武器已具备自主智能自导联锁"
                  : smartTotal !== null
                    ? `配件 ${money(weapon.smartLinkConvert.partsFee ?? 0)} + 工时 ${money(weapon.smartLinkConvert.serviceFee ?? 0)} = ${money(smartTotal)} 欧元`
                    : (weapon.smartLinkConvert.locked ?? "暂不可改造")}
              </small>
            </div>
            {!weapon.smartLinkConvert.installed && smartTotal !== null && (
              <div
                className={shopCss.gsActionWrap}
                {...previewBind(
                  previewGunsmithImpact(weapon, {
                    action: "convert",
                    conversion: "smart-link",
                    weapon: weapon.id,
                  }),
                )}
              >
                <Button
                  small
                  primary={!smartDisabled}
                  disabled={smartDisabled}
                  reason={smartReason}
                  onClick={() => {
                    const payload: GunsmithPayload = {
                      action: "convert",
                      conversion: "smart-link",
                      weapon: weapon.id,
                    };
                    onConfirm({
                      kind: "gunsmith",
                      weapon,
                      title: "加装智能靶向联锁",
                      description: `为 ${weapon.name} 加装独立智能校准联锁模块，无需手部智能连接义体亦可激活自导锁定。`,
                      payload,
                      partsFee: weapon.smartLinkConvert.partsFee ?? 0,
                      serviceFee: weapon.smartLinkConvert.serviceFee ?? 0,
                      total: smartTotal,
                      preview: previewGunsmithImpact(weapon, payload),
                    });
                  }}
                >
                  {`加装 ${money(smartTotal)}€`}
                </Button>
              </div>
            )}
          </div>
        </section>
      )}

      <section className={shopCss.gsSection} aria-label="改装槽位与货架直装">
        <h4 className={shopCss.gsSectionTitle}>
          <Asset id="interaction.techie" height={13} tint="var(--cp-yellow)" />
          槽位深改与货架直装
        </h4>
        {weapon.slots.map((slotEntry) => {
          const installed = slotEntry.installed;
          const detachFee = installed?.detachFee ?? null;
          const detachShort = detachFee !== null && detachFee > eddies;
          const detachDisabled =
            working ||
            Boolean(blocked) ||
            detachFee === null ||
            Boolean(installed?.detachLocked) ||
            detachShort;
          const lockFee = installed?.lockFee ?? null;
          const lockShort = lockFee !== null && lockFee > eddies;
          const lockDisabled =
            working ||
            Boolean(blocked) ||
            lockFee === null ||
            Boolean(installed?.lockLocked) ||
            lockShort;

          return (
            <div
              key={slotEntry.slot}
              className={shopCss.gsSlotCard}
              data-locked-slot={slotEntry.lockedSlot || undefined}
            >
              <div className={shopCss.gsSlotHead}>
                <strong>{slotEntry.label}</strong>
                <span className={slotEntry.lockedSlot ? shopCss.stockPill : shopCss.ownedPill}>
                  {slotEntry.lockedSlot ? "精工固锁" : "常规槽位"}
                </span>
              </div>

              {installed ? (
                <div className={shopCss.gsInstalledRow}>
                  <div className={shopCss.gsInstalledCopy}>
                    <b>{installed.name}</b>
                    {installed.ability && <small>{installed.ability}</small>}
                  </div>
                  <div className={shopCss.gsInstalledBtns}>
                    {slotEntry.lockedSlot && detachFee !== null && (
                      <div
                        className={shopCss.gsActionWrap}
                        {...previewBind(
                          previewGunsmithImpact(
                            weapon,
                            {
                              action: "detach",
                              weapon: weapon.id,
                              mod: installed.id,
                              slot: slotEntry.slot,
                            },
                            slotEntry.slot,
                          ),
                        )}
                      >
                        <Button
                          small
                          disabled={detachDisabled}
                          reason={
                            blocked ??
                            installed.detachLocked ??
                            (detachShort ? "欧元不够" : undefined)
                          }
                          onClick={() => {
                            const payload: GunsmithPayload = {
                              action: "detach",
                              weapon: weapon.id,
                              mod: installed.id,
                              slot: slotEntry.slot,
                            };
                            onConfirm({
                              kind: "gunsmith",
                              weapon,
                              title: `解锁并拆下 ${installed.name}`,
                              description: `由枪匠解除 ${weapon.name} 的${slotEntry.label}固锁并将 ${installed.name} 完整拆下退回背包。`,
                              payload,
                              partsFee: 0,
                              serviceFee: detachFee,
                              total: detachFee,
                              preview: previewGunsmithImpact(weapon, payload, slotEntry.slot),
                            });
                          }}
                        >
                          {`解锁拆下 ${money(detachFee)}€`}
                        </Button>
                      </div>
                    )}
                    {!slotEntry.lockedSlot && lockFee !== null && (
                      <Button
                        small
                        disabled={lockDisabled}
                        reason={
                          blocked ?? installed.lockLocked ?? (lockShort ? "欧元不够" : undefined)
                        }
                        onClick={() => {
                          const payload: GunsmithPayload = {
                            action: "convert",
                            conversion: "precision-lock",
                            weapon: weapon.id,
                            slot: slotEntry.slot,
                          };
                          onConfirm({
                            kind: "gunsmith",
                            weapon,
                            title: `精工固锁 ${slotEntry.label}`,
                            description: `将当前安装在${slotEntry.label}的 ${installed.name} 进行精工校准固锁，避免松动偏移。`,
                            payload,
                            partsFee: 0,
                            serviceFee: lockFee,
                            total: lockFee,
                            preview: previewGunsmithImpact(weapon, payload, slotEntry.slot),
                          });
                        }}
                      >
                        {`固锁 ${money(lockFee)}€`}
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                <p className={shopCss.gsEmptySlot}>该槽位当前空置</p>
              )}

              {slotEntry.options.length > 0 ? (
                <ul className={shopCss.gsOptList}>
                  {slotEntry.options.map((opt) => {
                    const total = opt.total;
                    const optShort = total !== null && total > eddies;
                    const optDisabled =
                      working ||
                      Boolean(blocked) ||
                      total === null ||
                      Boolean(opt.locked) ||
                      optShort;
                    const optReason = blocked ?? opt.locked ?? (optShort ? "欧元不够" : undefined);
                    const optArt = itemArtOf(opt.id);
                    const payload: GunsmithPayload = {
                      action: "install",
                      weapon: weapon.id,
                      mod: opt.id,
                      source: opt.source,
                      ...(installed ? { replace: installed.id } : {}),
                    };

                    return (
                      <li
                        key={`${opt.source}:${opt.id}`}
                        className={shopCss.gsOptItem}
                        style={{ "--item-tint": rarityTintOf(opt.rarity) } as CSSProperties}
                        {...previewBind(previewGunsmithImpact(weapon, payload, slotEntry.slot))}
                      >
                        {optArt && <Asset id={optArt} className={shopCss.gsOptArt} />}
                        <div className={shopCss.gsOptCopy}>
                          <div className={shopCss.gsOptTop}>
                            <b>{opt.name}</b>
                            <span className={shopCss.stockPill}>
                              {opt.source === "shelf"
                                ? `货架 · 剩 ${opt.left}`
                                : `背包自带 · ×${opt.left}`}
                            </span>
                          </div>
                          {opt.ability && <small>{opt.ability}</small>}
                          {total !== null && (
                            <span className={shopCss.gsOptPrice}>
                              {opt.partsFee
                                ? `配件 ${money(opt.partsFee)} + 工时 ${money(opt.serviceFee ?? 0)} = ${money(total)} 欧元`
                                : `工时 ${money(total)} 欧元`}
                            </span>
                          )}
                        </div>
                        <Button
                          small
                          disabled={optDisabled}
                          reason={optReason}
                          onClick={() => {
                            if (total === null) return;
                            onConfirm({
                              kind: "gunsmith",
                              weapon,
                              title: `${installed ? "换装" : "安装"} ${opt.name}`,
                              description: `${
                                opt.source === "shelf"
                                  ? "从本店货架购入并由枪匠"
                                  : "使用背包自带配件并由枪匠"
                              }为 ${weapon.name} 的${slotEntry.label}${
                                installed ? `换装（替换下的 ${installed.name} 退回背包）` : "加装"
                              }。`,
                              payload,
                              partsFee: opt.partsFee ?? 0,
                              serviceFee: opt.serviceFee ?? 0,
                              total,
                              preview: previewGunsmithImpact(weapon, payload, slotEntry.slot),
                            });
                          }}
                        >
                          {installed ? "换装" : "安装"}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className={shopCss.gsEmptySlot}>本店货架与背包暂无可装配件</p>
              )}
            </div>
          );
        })}
      </section>
    </aside>
  );
}

/** 商店终端：左栏双视图货架/回收/工坊筛选列表，右栏全息检视台；不调用模型，按投影报价即时结算 */
export function Shop({
  view,
  shop,
  onBuy,
  onSell,
  onGunsmith,
  gunsmithDisabledReason,
  onClose,
}: {
  readonly view: View;
  readonly shop: ShopView;
  /** 正在生成时不传，按钮不能点 */
  readonly onBuy?: ((id: string) => Promise<void>) | undefined;
  readonly onSell?: ((id: string) => Promise<void>) | undefined;
  readonly onGunsmith?: ((action: GunsmithPayload) => Promise<void>) | undefined;
  readonly gunsmithDisabledReason?: string | undefined;
  readonly onClose: () => void;
}) {
  const [mode, setMode] = useState<ShopMode>("buy");
  const [category, setCategory] = useState<string>("all");
  const [rarityFilter, setRarityFilter] = useState<string>("all");
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("default");
  const [layout, setLayout] = useState<ViewLayout>("grid");
  const [focus, setFocus] = useState<{ readonly mode: ShopMode; readonly id: string } | null>(() =>
    shop.shelf[0]
      ? { mode: "buy", id: shop.shelf[0].id }
      : shop.sell[0]
        ? { mode: "sell", id: shop.sell[0].id }
        : null,
  );
  const [confirming, setConfirming] = useState<
    { kind: "buy"; item: ShelfItem } | { kind: "sell"; item: SaleItem } | GunsmithConfirm | null
  >(null);
  const [working, setWorking] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const eddies = view.money.eddies;
  const prevEddiesRef = useRef(eddies);
  const [eddiesFeedback, setEddiesFeedback] = useState<{
    readonly seq: number;
    readonly delta: number;
    readonly pulsing: boolean;
  } | null>(null);

  useEffect(() => {
    const diff = eddies - prevEddiesRef.current;
    prevEddiesRef.current = eddies;
    if (diff === 0) return;
    const seq = Date.now();
    setEddiesFeedback({ seq, delta: diff, pulsing: true });
    const pulseTimer = window.setTimeout(() => {
      setEddiesFeedback((cur) => (cur && cur.seq === seq ? { ...cur, pulsing: false } : cur));
    }, 540);
    const clearTimer = window.setTimeout(() => {
      setEddiesFeedback((cur) => (cur && cur.seq === seq ? null : cur));
    }, 1150);
    return () => {
      window.clearTimeout(pulseTimer);
      window.clearTimeout(clearTimer);
    };
  }, [eddies]);

  const backpack = view.inventory.backpack;
  const keeperPortrait = portraitOf(shop.keeperNpc);
  const poiIcon: AssetId = shopPoiIconOf(shop.kind);
  const hasGunsmith = shop.gunsmith !== null;
  const effectiveMode: ShopMode = mode === "gunsmith" && !hasGunsmith ? "buy" : mode;
  const gunsmithBlocked =
    gunsmithDisabledReason ??
    shop.gunsmith?.available ??
    (!onGunsmith ? "当前无法进行枪匠工坊改装" : null);

  const terminalKicker = shop.blackMarket
    ? "BLACK MARKET // 非法黑市通道"
    : ((shop.kind ? SHOP_KIND_KICKER[shop.kind] : undefined) ?? "VENDOR TERMINAL // 商贩终端");

  const modNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const [id, name] of Object.entries(view.names.items)) map.set(id, name);
    for (const s of shop.shelf) map.set(s.id, s.name);
    for (const s of shop.sell) map.set(s.id, s.name);
    for (const w of shop.gunsmith?.weapons ?? []) {
      for (const slot of w.slots) {
        if (slot.installed) map.set(slot.installed.id, slot.installed.name);
        for (const opt of slot.options) map.set(opt.id, opt.name);
      }
    }
    return map;
  }, [view.names.items, shop.shelf, shop.sell, shop.gunsmith]);

  const resolveModName = (id: string) => modNameMap.get(id) ?? id;

  // 确认框开着时 Esc 只关确认框
  useLayer(onClose, !confirming);

  const run = async (task: () => Promise<void>) => {
    setWorking(true);
    try {
      await task();
      setConfirming(null);
    } catch {
      // 失败原因由外层提示条说明，确认框留着
    } finally {
      setWorking(false);
    }
  };

  const switchMode = (next: ShopMode) => {
    if (next === effectiveMode) return;
    setMode(next);
    setCategory("all");
  };

  const resetFilters = () => {
    setCategory("all");
    setRarityFilter("all");
    setOnlyAvailable(false);
    setQuery("");
    setSortMode("default");
  };

  const normalizedQuery = query.trim().toLowerCase();

  const categories = useMemo(() => {
    if (effectiveMode === "gunsmith") return [];
    const source = effectiveMode === "buy" ? shop.shelf : shop.sell;
    const seen = new Set<string>();
    const list: string[] = [];
    for (const item of source) {
      if (!seen.has(item.group)) {
        seen.add(item.group);
        list.push(item.group);
      }
    }
    return list;
  }, [effectiveMode, shop.shelf, shop.sell]);

  const effectiveCategory = category !== "all" && categories.includes(category) ? category : "all";

  const hasIconic = useMemo(() => {
    if (effectiveMode === "gunsmith") return false;
    const source = effectiveMode === "buy" ? shop.shelf : shop.sell;
    return source.some((item) => item.iconic);
  }, [effectiveMode, shop.shelf, shop.sell]);

  const effectiveRarity = rarityFilter === "iconic" && !hasIconic ? "all" : rarityFilter;

  const filteredShelf = useMemo(() => {
    const matched = shop.shelf.filter((item) => {
      if (effectiveCategory !== "all" && item.group !== effectiveCategory) return false;
      if (!matchesRarity(item, effectiveRarity)) return false;
      if (onlyAvailable && (item.locked !== null || item.left <= 0 || item.price > eddies)) {
        return false;
      }
      return matchesQuery(item, normalizedQuery);
    });
    if (sortMode === "default") return matched;
    const sorted = [...matched];
    if (sortMode === "priceAsc") sorted.sort((a, b) => a.price - b.price);
    else if (sortMode === "priceDesc") sorted.sort((a, b) => b.price - a.price);
    else if (sortMode === "rarityDesc") {
      sorted.sort((a, b) => {
        const diff = rarityScore(b.rarity, b.iconic) - rarityScore(a.rarity, a.iconic);
        return diff !== 0 ? diff : b.price - a.price;
      });
    }
    return sorted;
  }, [
    shop.shelf,
    effectiveCategory,
    effectiveRarity,
    onlyAvailable,
    eddies,
    normalizedQuery,
    sortMode,
  ]);

  const filteredSell = useMemo(() => {
    const matched = shop.sell.filter((item) => {
      if (effectiveCategory !== "all" && item.group !== effectiveCategory) return false;
      if (!matchesRarity(item, effectiveRarity)) return false;
      if (onlyAvailable && (item.locked !== null || item.value <= 0)) return false;
      return matchesQuery(item, normalizedQuery);
    });
    if (sortMode === "default") return matched;
    const sorted = [...matched];
    if (sortMode === "priceAsc") sorted.sort((a, b) => a.value - b.value);
    else if (sortMode === "priceDesc") sorted.sort((a, b) => b.value - a.value);
    else if (sortMode === "rarityDesc") {
      sorted.sort((a, b) => {
        const diff = rarityScore(b.rarity, b.iconic) - rarityScore(a.rarity, a.iconic);
        return diff !== 0 ? diff : b.value - a.value;
      });
    }
    return sorted;
  }, [shop.sell, effectiveCategory, effectiveRarity, onlyAvailable, normalizedQuery, sortMode]);

  const sellEstimate = useMemo(() => {
    let count = 0;
    let total = 0;
    for (const item of filteredSell) {
      if (item.locked === null && item.value > 0) {
        count += item.count;
        total += item.value * item.count;
      }
    }
    return { count, total };
  }, [filteredSell]);

  const groupedShelf = useMemo(
    () =>
      sortMode === "default"
        ? byGroup(filteredShelf)
        : filteredShelf.length > 0
          ? [[SORT_LABELS[sortMode], filteredShelf] as [string, ShelfItem[]]]
          : [],
    [filteredShelf, sortMode],
  );

  const groupedSell = useMemo(
    () =>
      sortMode === "default"
        ? byGroup(filteredSell)
        : filteredSell.length > 0
          ? [[SORT_LABELS[sortMode], filteredSell] as [string, SaleItem[]]]
          : [],
    [filteredSell, sortMode],
  );

  const inspectedBuy =
    effectiveMode === "buy"
      ? (filteredShelf.find((i) => focus?.mode === "buy" && i.id === focus.id) ?? filteredShelf[0])
      : undefined;

  const inspectedSell =
    effectiveMode === "sell"
      ? (filteredSell.find((i) => focus?.mode === "sell" && i.id === focus.id) ?? filteredSell[0])
      : undefined;

  const inspectedGunsmith =
    effectiveMode === "gunsmith" && shop.gunsmith
      ? (shop.gunsmith.weapons.find((w) => focus?.mode === "gunsmith" && w.id === focus.id) ??
        shop.gunsmith.weapons.find(
          (w) => focus?.mode === "gunsmith" && w.baseId === baseWeaponIdOf(focus.id),
        ) ??
        shop.gunsmith.weapons[0])
      : undefined;

  const activeIds = useMemo(() => {
    if (effectiveMode === "buy") return filteredShelf.map((i) => i.id);
    if (effectiveMode === "sell") return filteredSell.map((i) => i.id);
    return (shop.gunsmith?.weapons ?? []).map((w) => w.id);
  }, [effectiveMode, filteredShelf, filteredSell, shop.gunsmith]);

  const activeFocusedId =
    effectiveMode === "buy"
      ? inspectedBuy?.id
      : effectiveMode === "sell"
        ? inspectedSell?.id
        : inspectedGunsmith?.id;

  useEffect(() => {
    if (confirming) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField =
        target !== null &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (e.key === "/" && !inField && effectiveMode !== "gunsmith") {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (inField || activeIds.length === 0) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const curIdx = activeFocusedId ? activeIds.indexOf(activeFocusedId) : 0;
        const delta = e.key === "ArrowDown" ? 1 : -1;
        const nextIdx = (curIdx + delta + activeIds.length) % activeIds.length;
        const nextId = activeIds[nextIdx];
        if (nextId) setFocus({ mode: effectiveMode, id: nextId });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirming, effectiveMode, activeIds, activeFocusedId]);

  const totalInMode = effectiveMode === "buy" ? shop.shelf.length : shop.sell.length;
  const shownInMode = effectiveMode === "buy" ? filteredShelf.length : filteredSell.length;
  const hasActiveFilter =
    effectiveCategory !== "all" ||
    effectiveRarity !== "all" ||
    onlyAvailable ||
    normalizedQuery.length > 0 ||
    sortMode !== "default";

  const renderInspector = () => {
    if (effectiveMode === "gunsmith") {
      if (!inspectedGunsmith) {
        return (
          <aside aria-label="枪匠工坊检视台">
            <div className={shopCss.emptyState}>随身背包里没有可改装的武器。</div>
          </aside>
        );
      }
      return (
        <GunsmithInspector
          key={inspectedGunsmith.id}
          weapon={inspectedGunsmith}
          eddies={eddies}
          working={working}
          blocked={gunsmithBlocked}
          onConfirm={(nextConfirm) => setConfirming(nextConfirm)}
        />
      );
    }

    if (effectiveMode === "buy") {
      if (!inspectedBuy) {
        return (
          <aside aria-label="商品详情检视">
            <div className={shopCss.emptyState}>
              {shop.shelf.length === 0
                ? "货架目前空着，暂无可买的商品。"
                : "当前筛选条件下没有可检视的商品。"}
            </div>
          </aside>
        );
      }

      const item = inspectedBuy;
      const short = item.price > eddies;
      const owned = backpack[item.id] ?? 0;
      const weaponSummary = summarizeWeaponState(item.weaponState, resolveModName);

      return (
        <ShopInspector
          key={`buy-${item.id}`}
          mode="buy"
          id={item.id}
          baseId={item.baseId}
          kind={item.kind}
          name={item.name}
          group={item.group}
          subLabel={item.subLabel}
          rarity={item.rarity}
          rarityLabel={item.rarityLabel}
          iconic={item.iconic}
          bulky={item.bulky}
          chargesText={item.charges !== null ? `可用 ${item.charges} 次` : null}
          healPercent={item.healPercent}
          ability={item.ability}
          weaponSummary={weaponSummary}
          fallbackIcon={poiIcon}
          stageBadge={
            <span
              className={shopCss.stockPill}
              data-empty={item.left === 0 || undefined}
              data-low={(item.left > 0 && item.left <= 2) || undefined}
            >
              {item.left > 0 ? `现货 ${item.left}` : "售罄"}
            </span>
          }
          primaryLabel="货架标价"
          primaryValue={`${money(item.price)} 欧元`}
          primaryTone={short ? "bad" : "yellow"}
          rows={[
            {
              label: "店内现货",
              value: item.left > 0 ? `剩 ${item.left} 件` : "售罄",
              tone: item.left === 0 ? "bad" : item.left <= 2 ? "yellow" : "cyan",
            },
            {
              label: "背包已有",
              value: owned > 0 ? `${owned} 件` : "无",
              ...(owned > 0 ? { tone: "cyan" as const } : {}),
            },
            {
              label: "买后余额",
              value: short
                ? `还差 ${money(item.price - eddies)} 欧元`
                : `${money(eddies)} → ${money(eddies - item.price)} 欧元`,
              ...(short ? { tone: "bad" as const } : {}),
            },
          ]}
          alert={
            item.locked ??
            (short ? `身上还差 ${money(item.price - eddies)} 欧元，暂无法买下。` : null)
          }
          actionLabel={`买下（${money(item.price)} 欧元）`}
          actionDisabled={!onBuy || working || item.locked !== null || short}
          actionReason={item.locked ?? (short ? "欧元不够" : undefined)}
          onAction={() => setConfirming({ kind: "buy", item })}
        />
      );
    }

    if (!inspectedSell) {
      return (
        <aside aria-label="商品详情检视">
          <div className={shopCss.emptyState}>
            {shop.sell.length === 0
              ? "背包是空的，身上穿着或快捷栏里的物品需先卸下。"
              : "当前筛选条件下没有可检视的背包物品。"}
          </div>
        </aside>
      );
    }

    const item = inspectedSell;
    const detail = view.inventory.details?.[item.id];
    const owned = backpack[item.id] ?? item.count;
    const unavailable = item.locked !== null || item.value <= 0;
    const weaponSummary = summarizeWeaponState(item.weaponState, resolveModName);
    const rows: InspectorMetaRow[] = [
      { label: "背包已有", value: `${owned} 件`, tone: "cyan" },
      ...(unavailable
        ? []
        : [
            {
              label: "卖后余额",
              value: `${money(eddies)} → ${money(eddies + item.value)} 欧元`,
              tone: "yellow" as const,
            },
          ]),
    ];

    return (
      <ShopInspector
        key={`sell-${item.id}`}
        mode="sell"
        id={item.id}
        baseId={item.baseId}
        kind={item.kind}
        name={item.name}
        group={item.group}
        subLabel={item.subLabel}
        rarity={item.rarity}
        rarityLabel={item.rarityLabel}
        iconic={item.iconic}
        bulky={item.bulky}
        chargesText={
          detail?.charges !== null && detail?.charges !== undefined
            ? `剩余 ${detail.remaining ?? detail.charges}/${detail.charges} 次`
            : null
        }
        healPercent={detail?.healPercent ?? null}
        ability={item.ability}
        weaponSummary={weaponSummary}
        fallbackIcon="notify.inventory"
        stageBadge={<span className={shopCss.ownedPill}>背包 ×{owned}</span>}
        primaryLabel="回收报价"
        primaryValue={unavailable ? sellPriceLabel(item) : `+${money(item.value)} 欧元`}
        primaryTone={unavailable ? "bad" : "cyan"}
        rows={rows}
        alert={item.locked ?? (item.value <= 0 ? "这家店不收购此类物品。" : null)}
        actionLabel={unavailable ? "暂不可出手" : `卖出一件（+${money(item.value)} 欧元）`}
        actionDisabled={!onSell || working || unavailable}
        actionReason={item.locked ?? (item.value <= 0 ? "这家店不收" : undefined)}
        onAction={() => setConfirming({ kind: "sell", item })}
      />
    );
  };

  const confirmingWeaponSummary =
    confirming && confirming.kind !== "gunsmith"
      ? summarizeWeaponState(confirming.item.weaponState, resolveModName)
      : null;

  const confirmVisual = useMemo(() => {
    if (!confirming) return null;
    if (confirming.kind === "gunsmith") {
      const w = confirming.weapon;
      const tint = rarityTintOf(w.rarity, w.iconic);
      const art = itemArtOf(w.baseId ?? w.id);
      return {
        asset: art ?? weaponHudIconOf(w.baseId ?? w.id, w.subLabel),
        isArtwork: Boolean(art),
        name: w.name,
        subtitle: [rarityLabelOf(w.rarity, w.iconic) ?? w.rarityLabel, w.subLabel]
          .filter(Boolean)
          .join(" · "),
        tint,
      };
    }
    const it = confirming.item;
    const tint = rarityTintOf(it.rarity, it.iconic);
    const vis = resolveArtOrIcon(
      it.id,
      it.baseId,
      it.kind,
      it.subLabel,
      confirming.kind === "buy" ? poiIcon : "notify.inventory",
    );
    return {
      asset: vis.asset,
      isArtwork: vis.isArtwork,
      name: it.name,
      subtitle: [
        it.group,
        rarityLabelOf(it.rarity, it.iconic) ?? it.rarityLabel,
        it.subLabel !== it.group ? it.subLabel : null,
      ]
        .filter(Boolean)
        .join(" · "),
      tint,
    };
  }, [confirming, poiIcon]);

  return (
    <div className={shopCss.backdrop}>
      <div
        role="dialog"
        aria-modal
        aria-label={shop.name}
        className={shopCss.modal}
        data-black-market={shop.blackMarket || undefined}
      >
        <Panel as="div" line={shop.blackMarket ? "var(--cp-red)" : "var(--cp-yellow)"} frame>
          <div className={shopCss.shell} data-black-market={shop.blackMarket || undefined}>
            {/* 顶部商贩终端横幅 */}
            <header className={shopCss.head} data-black-market={shop.blackMarket || undefined}>
              <div className={shopCss.identity}>
                <div className={shopCss.keeperFrame}>
                  <CellFrame />
                  {keeperPortrait ? (
                    <>
                      <Asset id={keeperPortrait} height={64} alt={shop.keeper} />
                      <span
                        className={shopCss.keeperScan}
                        style={{ backgroundImage: cssUrl("fx.scanlines") }}
                        aria-hidden
                      />
                      <span className={shopCss.keeperPoiBadge} aria-hidden>
                        <Asset id={poiIcon} height={13} tint="currentColor" />
                      </span>
                    </>
                  ) : (
                    <Asset
                      id={poiIcon}
                      height={32}
                      tint={shop.blackMarket ? "var(--cp-red)" : "var(--cp-yellow)"}
                      className={shopCss.poiIcon}
                    />
                  )}
                </div>

                <div className={shopCss.titleBlock}>
                  <div className={shopCss.terminalKicker}>
                    <span className={shopCss.terminalDot} aria-hidden />
                    <span>{terminalKicker}</span>
                  </div>
                  <div className={shopCss.titleRow}>
                    <h3>{shop.name}</h3>
                    <div className={shopCss.tags}>
                      <span className={shopCss.tag}>
                        店主 {shop.keeper}
                        {shop.keeperAffinity !== null ? ` · 好感 ${shop.keeperAffinity}` : ""}
                      </span>
                      {shop.blackMarket && (
                        <span className={shopCss.tagBlackMarket}>
                          <Asset id="interaction.illegal" height={11} tint="currentColor" />
                          黑市货源 · 来路不明
                        </span>
                      )}
                      {shop.restockAt && (
                        <span
                          className={
                            shop.restockAt.startsWith("运输受阻")
                              ? shopCss.tagWarn
                              : shopCss.tagRestock
                          }
                        >
                          {shop.restockAt.startsWith("运输受阻")
                            ? shop.restockAt
                            : `补货：${shop.restockAt}`}
                        </span>
                      )}
                    </div>
                  </div>
                  {shop.note && (
                    <p className={shopCss.shopNote} title={shop.note}>
                      {shop.note}
                    </p>
                  )}
                </div>
              </div>

              <div className={shopCss.headActions}>
                <div
                  className={shopCss.eddiesBadge}
                  data-pulse={
                    eddiesFeedback?.pulsing
                      ? eddiesFeedback.delta > 0
                        ? "gain"
                        : "spend"
                      : undefined
                  }
                >
                  <CellFrame />
                  <Asset id="notify.cash" height={18} tint="var(--cp-yellow)" />
                  <div className={shopCss.eddiesMeta}>
                    <span className={shopCss.eddiesLabel}>EDDIE BALANCE</span>
                    <span className={shopCss.eddiesValue}>{money(eddies)} €</span>
                  </div>
                  {eddiesFeedback && (
                    <span
                      key={eddiesFeedback.seq}
                      className={shopCss.eddiesDelta}
                      data-dir={eddiesFeedback.delta > 0 ? "gain" : "spend"}
                      aria-live="polite"
                    >
                      {eddiesFeedback.delta > 0
                        ? `+${money(eddiesFeedback.delta)} €`
                        : `${money(eddiesFeedback.delta)} €`}
                    </span>
                  )}
                </div>
                <Button small onClick={onClose}>
                  <span className={shopCss.closeBtnInner}>
                    <Asset id="key.esc" height={14} tint="currentColor" />
                    离开
                  </span>
                </Button>
              </div>
            </header>

            {/* 两层紧凑控制台 */}
            <nav className={shopCss.toolbar} aria-label="商店模式与货架筛选">
              <div className={shopCss.toolbarTop}>
                <div className={shopCss.modeGroup}>
                  <div className={shopCss.modeTabs} role="tablist" aria-label="交易模式">
                    <button
                      type="button"
                      role="tab"
                      className={shopCss.modeTab}
                      aria-selected={effectiveMode === "buy"}
                      onClick={() => switchMode("buy")}
                    >
                      <span>买进货架</span>
                      <span className={shopCss.modeCount}>{shop.shelf.length}</span>
                    </button>
                    <button
                      type="button"
                      role="tab"
                      className={shopCss.modeTab}
                      aria-selected={effectiveMode === "sell"}
                      onClick={() => switchMode("sell")}
                    >
                      <span>出手回收</span>
                      <span className={shopCss.modeCount}>{shop.sell.length}</span>
                    </button>
                    {hasGunsmith && (
                      <button
                        type="button"
                        role="tab"
                        className={shopCss.modeTab}
                        aria-selected={effectiveMode === "gunsmith"}
                        onClick={() => switchMode("gunsmith")}
                      >
                        <span>武器工坊</span>
                        <span className={shopCss.modeCount}>
                          {shop.gunsmith?.weapons.length ?? 0}
                        </span>
                      </button>
                    )}
                  </div>

                  {effectiveMode === "sell" && sellEstimate.count > 0 && (
                    <span className={shopCss.sellEstimate}>
                      当前可售 {sellEstimate.count} 件 · 估价{" "}
                      <strong>+{money(sellEstimate.total)} €</strong>
                    </span>
                  )}
                </div>

                {effectiveMode !== "gunsmith" && (
                  <div className={shopCss.utilityControls}>
                    <div className={shopCss.searchCell}>
                      <CellFrame />
                      <input
                        ref={searchInputRef}
                        type="search"
                        className={shopCss.searchInput}
                        aria-label={
                          effectiveMode === "buy"
                            ? "检索商品名称、品类或效果"
                            : "检索背包物品名称、品类或效果"
                        }
                        placeholder={
                          effectiveMode === "buy"
                            ? "检索商品名 / 品类 / 效果…"
                            : "检索背包物品 / 品类 / 效果…"
                        }
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                      {query ? (
                        <button
                          type="button"
                          className={shopCss.searchClear}
                          aria-label="清空搜索"
                          onClick={() => setQuery("")}
                        >
                          ×
                        </button>
                      ) : (
                        <span className={shopCss.searchShortcut} aria-hidden>
                          /
                        </span>
                      )}
                    </div>

                    <label className={shopCss.sortSelectWrap}>
                      <span>排序</span>
                      <select
                        className={shopCss.sortSelect}
                        aria-label="排序方式"
                        value={sortMode}
                        onChange={(e) => setSortMode(e.target.value as SortMode)}
                      >
                        <option value="default">默认分组</option>
                        <option value="priceAsc">价格 ↑</option>
                        <option value="priceDesc">价格 ↓</option>
                        <option value="rarityDesc">稀有度 ↓</option>
                      </select>
                    </label>

                    <div className={shopCss.viewSwitch}>
                      <button
                        type="button"
                        className={shopCss.viewBtn}
                        aria-label="展柜网格视图"
                        aria-pressed={layout === "grid"}
                        onClick={() => setLayout("grid")}
                      >
                        展柜
                      </button>
                      <button
                        type="button"
                        className={shopCss.viewBtn}
                        aria-label="明细列表视图"
                        aria-pressed={layout === "list"}
                        onClick={() => setLayout("list")}
                      >
                        清单
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {effectiveMode !== "gunsmith" && (
                <div className={shopCss.filterRow}>
                  <div className={shopCss.filterLeft}>
                    {categories.length > 0 && (
                      <>
                        <div className={shopCss.catTabs}>
                          <button
                            type="button"
                            className={shopCss.catTab}
                            aria-pressed={effectiveCategory === "all"}
                            onClick={() => setCategory("all")}
                          >
                            全部
                          </button>
                          {categories.map((cat) => (
                            <button
                              key={cat}
                              type="button"
                              className={shopCss.catTab}
                              aria-pressed={effectiveCategory === cat}
                              onClick={() => setCategory((cur) => (cur === cat ? "all" : cat))}
                            >
                              {cat}
                            </button>
                          ))}
                        </div>
                        <span className={shopCss.filterDivider} aria-hidden />
                      </>
                    )}

                    <div className={shopCss.rarityChips}>
                      <button
                        type="button"
                        className={shopCss.rarityChip}
                        aria-pressed={effectiveRarity === "all"}
                        onClick={() => setRarityFilter("all")}
                      >
                        全品级
                      </button>
                      {RARITY_ORDER.map((r) => (
                        <button
                          key={r}
                          type="button"
                          className={shopCss.rarityChip}
                          data-rarity={r}
                          aria-pressed={effectiveRarity === r}
                          onClick={() => setRarityFilter((cur) => (cur === r ? "all" : r))}
                        >
                          <span className={shopCss.rarityDot} aria-hidden />
                          {rarityLabelOf(r)}
                        </button>
                      ))}
                      {hasIconic && (
                        <button
                          type="button"
                          className={shopCss.rarityChip}
                          data-rarity="iconic"
                          aria-pressed={effectiveRarity === "iconic"}
                          onClick={() =>
                            setRarityFilter((cur) => (cur === "iconic" ? "all" : "iconic"))
                          }
                        >
                          <span className={shopCss.rarityDot} aria-hidden />
                          不朽
                        </button>
                      )}
                      <button
                        type="button"
                        className={shopCss.toggleChip}
                        aria-pressed={onlyAvailable}
                        onClick={() => setOnlyAvailable((v) => !v)}
                      >
                        {effectiveMode === "buy" ? "仅看可买" : "仅看可收"}
                      </button>
                    </div>
                  </div>

                  <div className={shopCss.filterRight}>
                    <span className={shopCss.matchCount}>
                      显示 <b>{shownInMode}</b> / {totalInMode}
                    </span>
                    {hasActiveFilter && (
                      <button type="button" className={shopCss.resetBtn} onClick={resetFilters}>
                        重置
                      </button>
                    )}
                  </div>
                </div>
              )}
            </nav>

            {/* 双栏主体：左货架/回收/工坊武器，右全息检视台 */}
            <div key={effectiveMode} className={shopCss.body}>
              <div className={shopCss.catalog}>
                {effectiveMode === "gunsmith" && shop.gunsmith ? (
                  <>
                    {gunsmithBlocked && (
                      <p role="status" className={shopCss.inspectAlert}>
                        {gunsmithBlocked}
                      </p>
                    )}
                    {shop.gunsmith.weapons.length === 0 ? (
                      <div className={shopCss.emptyState}>
                        <span>随身背包里没有可改装的武器，先去买把家伙或者从安全屋取出。</span>
                      </div>
                    ) : (
                      <section className={shopCss.groupSection}>
                        <h3 className={shopCss.groupHead}>
                          <span>随身武器工坊</span>
                          <span className={shopCss.groupHeadBadge}>
                            {shop.gunsmith.weapons.length}
                          </span>
                        </h3>
                        <ul className={shopCss.cardList}>
                          {shop.gunsmith.weapons.map((w) => {
                            const art = itemArtOf(w.baseId ?? w.id);
                            const hudIcon = weaponHudIconOf(w.baseId ?? w.id, w.subLabel);
                            const installedCount = w.slots.filter(
                              (s) => s.installed !== null,
                            ).length;
                            const lockedCount = w.slots.filter((s) => s.lockedSlot).length;
                            const isMelee =
                              w.subLabel.includes("刀剑") || w.subLabel.includes("钝器");
                            const summary = summarizeWeaponState(w.weaponState, resolveModName);
                            const rarityTint = rarityTintOf(w.rarity, w.iconic);

                            return (
                              <li
                                key={w.id}
                                className={shopCss.itemCard}
                                data-selected={inspectedGunsmith?.id === w.id || undefined}
                                style={{ "--item-tint": rarityTint } as CSSProperties}
                              >
                                <CellFrame />
                                <button
                                  type="button"
                                  style={CARD_FOCUS_BTN_STYLE}
                                  onClick={() => setFocus({ mode: "gunsmith", id: w.id })}
                                >
                                  <span className={shopCss.thumbBox} aria-hidden>
                                    {art ? (
                                      <Asset id={art} alt={w.name} className={shopCss.thumbImg} />
                                    ) : (
                                      <Asset
                                        id={hudIcon}
                                        height={26}
                                        tint={rarityTint}
                                        className={shopCss.thumbImg}
                                      />
                                    )}
                                  </span>
                                  <span className={shopCss.itemBody}>
                                    <span className={shopCss.itemTitleRow}>
                                      <strong className={shopCss.itemName}>{w.name}</strong>
                                      {w.grantsSmartLink && (
                                        <span className={shopCss.ownedPill}>智能联锁</span>
                                      )}
                                      {!isMelee && w.noise === "silent" && (
                                        <span className={shopCss.ownedPill}>已消音</span>
                                      )}
                                      {lockedCount > 0 && (
                                        <span className={shopCss.stockPill}>
                                          固锁×{lockedCount}
                                        </span>
                                      )}
                                    </span>
                                    <span className={shopCss.itemMeta}>
                                      {[
                                        w.rarityLabel,
                                        w.subLabel,
                                        CONCEALMENT_LABELS[w.concealment],
                                      ].join(" · ")}
                                    </span>
                                    {summary?.inlineText && (
                                      <span className={shopCss.itemModLine}>
                                        {summary.inlineText}
                                      </span>
                                    )}
                                  </span>
                                </button>
                                <div className={shopCss.itemAside}>
                                  <span className={shopCss.slotDots} aria-hidden>
                                    {w.slots.map((slot) => (
                                      <span
                                        key={slot.slot}
                                        className={shopCss.slotDot}
                                        data-filled={slot.installed !== null || undefined}
                                        data-locked={slot.lockedSlot || undefined}
                                      />
                                    ))}
                                  </span>
                                  <span className={shopCss.ownedPill}>
                                    {installedCount}/{w.slots.length}
                                  </span>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </section>
                    )}
                  </>
                ) : effectiveMode === "buy" ? (
                  groupedShelf.length === 0 ? (
                    <div className={shopCss.emptyState}>
                      <span>
                        {shop.shelf.length === 0
                          ? "这家店的货架目前是空的。"
                          : "当前筛选条件没有匹配的商品。"}
                      </span>
                      {hasActiveFilter && (
                        <Button small onClick={resetFilters}>
                          重置筛选条件
                        </Button>
                      )}
                    </div>
                  ) : (
                    groupedShelf.map(([group, items]) => (
                      <section key={group} className={shopCss.groupSection}>
                        <h3 className={shopCss.groupHead}>
                          <span>{group}</span>
                          <span className={shopCss.groupHeadBadge}>{items.length}</span>
                        </h3>
                        <ul className={layout === "grid" ? shopCss.cardGrid : shopCss.cardList}>
                          {items.map((item) => {
                            const short = item.price > eddies;
                            const owned = backpack[item.id] ?? 0;
                            const weaponSummary = summarizeWeaponState(
                              item.weaponState,
                              resolveModName,
                            );
                            return (
                              <ShopCatalogCard
                                key={item.id}
                                layout={layout}
                                id={item.id}
                                baseId={item.baseId}
                                kind={item.kind}
                                name={item.name}
                                group={item.group}
                                subLabel={item.subLabel}
                                rarity={item.rarity}
                                rarityLabel={item.rarityLabel}
                                iconic={item.iconic}
                                bulky={item.bulky}
                                selected={inspectedBuy?.id === item.id}
                                locked={item.locked !== null}
                                statusText={item.locked ? "不可买" : null}
                                weaponSummary={weaponSummary}
                                fallbackIcon={poiIcon}
                                pills={
                                  <>
                                    {owned > 0 && (
                                      <span className={shopCss.ownedPill}>已有 ×{owned}</span>
                                    )}
                                    <span
                                      className={shopCss.stockPill}
                                      data-empty={item.left === 0 || undefined}
                                      data-low={(item.left > 0 && item.left <= 2) || undefined}
                                    >
                                      {item.left > 0 ? `剩 ${item.left}` : "售罄"}
                                    </span>
                                  </>
                                }
                                priceText={`${money(item.price)} €`}
                                {...(short ? { priceTone: "short" as const } : {})}
                                actionLabel="买"
                                actionDisabled={!onBuy || working || item.locked !== null || short}
                                actionReason={item.locked ?? (short ? "欧元不够" : undefined)}
                                onFocus={() => setFocus({ mode: "buy", id: item.id })}
                                onAction={() => setConfirming({ kind: "buy", item })}
                              />
                            );
                          })}
                        </ul>
                      </section>
                    ))
                  )
                ) : groupedSell.length === 0 ? (
                  <div className={shopCss.emptyState}>
                    <span>
                      {shop.sell.length === 0
                        ? "背包是空的，身上穿着或快捷栏里的物品需先卸下才能出手。"
                        : "当前筛选条件没有匹配的背包物品。"}
                    </span>
                    {hasActiveFilter && (
                      <Button small onClick={resetFilters}>
                        重置筛选条件
                      </Button>
                    )}
                  </div>
                ) : (
                  groupedSell.map(([group, items]) => (
                    <section key={group} className={shopCss.groupSection}>
                      <h3 className={shopCss.groupHead}>
                        <span>{group}</span>
                        <span className={shopCss.groupHeadBadge}>{items.length}</span>
                      </h3>
                      <ul className={layout === "grid" ? shopCss.cardGrid : shopCss.cardList}>
                        {items.map((s) => {
                          const unavailable = s.locked !== null || s.value <= 0;
                          const weaponSummary = summarizeWeaponState(s.weaponState, resolveModName);
                          return (
                            <ShopCatalogCard
                              key={s.id}
                              layout={layout}
                              id={s.id}
                              baseId={s.baseId}
                              kind={s.kind}
                              name={s.name}
                              group={s.group}
                              subLabel={s.subLabel}
                              rarity={s.rarity}
                              rarityLabel={s.rarityLabel}
                              iconic={s.iconic}
                              bulky={s.bulky}
                              selected={inspectedSell?.id === s.id}
                              locked={unavailable}
                              statusText={s.locked ? "不可出售" : null}
                              weaponSummary={weaponSummary}
                              fallbackIcon="notify.inventory"
                              pills={
                                s.count > 1 ? (
                                  <span className={shopCss.ownedPill}>×{s.count}</span>
                                ) : undefined
                              }
                              priceText={sellPriceLabel(s)}
                              priceTone={unavailable ? "bad" : "sell"}
                              actionLabel="卖"
                              actionDisabled={!onSell || working || unavailable}
                              actionReason={s.locked ?? (s.value <= 0 ? "这家店不收" : undefined)}
                              onFocus={() => setFocus({ mode: "sell", id: s.id })}
                              onAction={() => setConfirming({ kind: "sell", item: s })}
                            />
                          );
                        })}
                      </ul>
                    </section>
                  ))
                )}
              </div>

              {renderInspector()}
            </div>
          </div>
        </Panel>
      </div>

      {confirming && (
        <Dialog
          title={
            confirming.kind === "gunsmith"
              ? `${confirming.title}？`
              : confirming.kind === "buy"
                ? `买下${confirming.item.name}？`
                : `把${confirming.item.name}卖给${shop.keeper}？`
          }
          tone="info"
          onClose={() => setConfirming(null)}
          actions={
            <>
              <Button
                primary
                disabled={
                  working ||
                  !(confirming.kind === "gunsmith"
                    ? onGunsmith
                    : confirming.kind === "buy"
                      ? onBuy
                      : onSell)
                }
                onClick={() => {
                  if (confirming.kind === "gunsmith") {
                    if (onGunsmith) void run(() => onGunsmith(confirming.payload));
                  } else {
                    const id = confirming.item.id;
                    const task = confirming.kind === "buy" ? onBuy : onSell;
                    if (task) void run(() => task(id));
                  }
                }}
              >
                {working
                  ? "结算中…"
                  : confirming.kind === "gunsmith"
                    ? `支付 ${money(confirming.total)} 欧元并改装`
                    : confirming.kind === "buy"
                      ? `付 ${money(confirming.item.price)} 欧元`
                      : `收 ${money(confirming.item.value)} 欧元`}
              </Button>
              <Button onClick={() => setConfirming(null)}>再想想</Button>
            </>
          }
        >
          {confirmVisual && (
            <div
              className={shopCss.dialogItemHead}
              style={{ "--item-tint": confirmVisual.tint } as CSSProperties}
            >
              <span className={shopCss.dialogThumb} aria-hidden>
                {confirmVisual.isArtwork ? (
                  <Asset
                    id={confirmVisual.asset}
                    alt={confirmVisual.name}
                    className={shopCss.dialogThumbImg}
                  />
                ) : (
                  <Asset
                    id={confirmVisual.asset}
                    height={28}
                    tint={confirmVisual.tint}
                    className={shopCss.dialogThumbImg}
                  />
                )}
              </span>
              <div className={shopCss.dialogItemCopy}>
                <strong>{confirmVisual.name}</strong>
                {confirmVisual.subtitle && <span>{confirmVisual.subtitle}</span>}
              </div>
            </div>
          )}

          {confirming.kind === "gunsmith" ? (
            <>
              <p className={shopCss.dialogSummary}>{confirming.description}</p>
              <div className={shopCss.dialogMeta}>
                {confirming.partsFee > 0 && (
                  <div className={shopCss.dialogMetaRow}>
                    <span>配件费用</span>
                    <strong>{money(confirming.partsFee)} 欧元</strong>
                  </div>
                )}
                <div className={shopCss.dialogMetaRow}>
                  <span>工匠工时</span>
                  <strong>{money(confirming.serviceFee)} 欧元</strong>
                </div>
                <div className={shopCss.dialogMetaRow}>
                  <span>合计应付</span>
                  <strong>{money(confirming.total)} 欧元</strong>
                </div>
                <div className={shopCss.dialogMetaRow}>
                  <span>改后余额</span>
                  <strong data-tone={eddies - confirming.total < 0 ? "bad" : undefined}>
                    {money(eddies)} → {money(eddies - confirming.total)} 欧元
                  </strong>
                </div>
                {confirming.preview.concealment !== confirming.weapon.concealment && (
                  <div className={shopCss.dialogMetaRow}>
                    <span>隐蔽变化</span>
                    <strong data-tone="cyan">
                      {CONCEALMENT_LABELS[confirming.weapon.concealment]} →{" "}
                      {CONCEALMENT_LABELS[confirming.preview.concealment]}
                    </strong>
                  </div>
                )}
                {confirming.preview.noise !== confirming.weapon.noise && (
                  <div className={shopCss.dialogMetaRow}>
                    <span>声学变化</span>
                    <strong data-tone="cyan">
                      {NOISE_LABELS[confirming.weapon.noise]} →{" "}
                      {NOISE_LABELS[confirming.preview.noise]}
                    </strong>
                  </div>
                )}
                {confirming.preview.smartLink !== confirming.weapon.grantsSmartLink && (
                  <div className={shopCss.dialogMetaRow}>
                    <span>智能联锁</span>
                    <strong data-tone="cyan">未激活 → 已激活</strong>
                  </div>
                )}
              </div>
            </>
          ) : confirming.kind === "buy" ? (
            <>
              <p className={shopCss.dialogSummary}>买下后直接放入随身背包。</p>
              {confirming.item.ability && (
                <p className={shopCss.dialogSummary}>{confirming.item.ability}</p>
              )}
              {confirmingWeaponSummary?.inlineText && (
                <p className={shopCss.dialogSummary}>
                  随枪配置：{confirmingWeaponSummary.inlineText}
                </p>
              )}
              <div className={shopCss.dialogMeta}>
                <div className={shopCss.dialogMetaRow}>
                  <span>商品标价</span>
                  <strong>-{money(confirming.item.price)} 欧元</strong>
                </div>
                <div className={shopCss.dialogMetaRow}>
                  <span>余额变动</span>
                  <strong data-tone={eddies - confirming.item.price < 0 ? "bad" : undefined}>
                    {money(eddies)} → {money(eddies - confirming.item.price)} 欧元
                  </strong>
                </div>
              </div>
            </>
          ) : (
            <>
              <p className={shopCss.dialogSummary}>店里按参考价的两成收购，卖出后不可撤回。</p>
              {confirming.item.ability && (
                <p className={shopCss.dialogSummary}>{confirming.item.ability}</p>
              )}
              {confirmingWeaponSummary?.inlineText && (
                <p className={shopCss.dialogSummary}>
                  随枪配置：{confirmingWeaponSummary.inlineText}
                </p>
              )}
              <div className={shopCss.dialogMeta} data-tone="sell">
                <div className={shopCss.dialogMetaRow}>
                  <span>回收所得</span>
                  <strong data-tone="cyan">+{money(confirming.item.value)} 欧元</strong>
                </div>
                <div className={shopCss.dialogMetaRow}>
                  <span>余额变动</span>
                  <strong>
                    {money(eddies)} → {money(eddies + confirming.item.value)} 欧元
                  </strong>
                </div>
              </div>
            </>
          )}
        </Dialog>
      )}
    </div>
  );
}
