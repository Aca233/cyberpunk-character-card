import { type CSSProperties, type ReactNode, useMemo, useState } from "react";
import type { AssetId } from "../../assets";
import { Asset, cssUrl } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { CellFrame } from "../../ui/FrameBox";
import { useLayer } from "../../ui/layers";
import { Panel } from "../../ui/Panel";
import { itemArtOf, portraitOf, shopPoiIconOf } from "./art";
import { RARITY_ORDER, rarityLabelOf, rarityTintOf } from "./cyberwareMeta";
import shopCss from "./shop.module.css";
import type { View } from "./view";

type ShopView = View["shops"][number];
type ShelfItem = ShopView["shelf"][number];
type SaleItem = ShopView["sell"][number];
type ShopMode = "buy" | "sell";

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
  if (item.value > 0) return `+${money(item.value)} 欧元`;
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

function ShopCatalogCard({
  id,
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
  pills,
  priceText,
  priceTone,
  actionLabel,
  actionDisabled,
  actionReason,
  onFocus,
  onAction,
}: {
  readonly id: string;
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
  readonly pills?: ReactNode;
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
  const art = itemArtOf(id);
  const metaText = [
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
          {art ? (
            <Asset id={art} alt={name} className={shopCss.thumbImg} />
          ) : (
            <span className={shopCss.thumbFallback}>{group.slice(0, 2)}</span>
          )}
        </span>

        <span className={shopCss.itemBody}>
          <span className={shopCss.itemTitleRow}>
            <strong className={shopCss.itemName}>{name}</strong>
            {pills}
          </span>
          {metaText && <span className={shopCss.itemMeta}>{metaText}</span>}
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
  id,
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
  fallbackIcon,
  rows,
  alert,
  actionLabel,
  actionDisabled,
  actionReason,
  onAction,
}: {
  readonly id: string;
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
  readonly fallbackIcon: AssetId;
  readonly rows: readonly InspectorMetaRow[];
  readonly alert: string | null;
  readonly actionLabel: string;
  readonly actionDisabled: boolean;
  readonly actionReason?: string | undefined;
  readonly onAction: () => void;
}) {
  const art = itemArtOf(id);
  const rarityTint = rarityTintOf(rarity, iconic);
  const rarityText = rarityLabelOf(rarity, iconic) ?? rarityLabel;

  return (
    <aside
      className={shopCss.inspector}
      aria-label="商品详情检视"
      style={{ "--item-tint": rarityTint } as CSSProperties}
    >
      <CellFrame />
      <div className={shopCss.inspectShowcase}>
        <CellFrame />
        <span
          className={shopCss.inspectGrid}
          style={{ backgroundImage: cssUrl("fx.grid") }}
          aria-hidden
        />
        {art ? (
          <Asset id={art} alt={name} className={shopCss.inspectArt} />
        ) : (
          <Asset id={fallbackIcon} height={48} tint={rarityTint} className={shopCss.inspectArt} />
        )}
      </div>

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

      <div className={shopCss.inspectMetaGrid}>
        {rows.map((row) => (
          <div key={row.label} className={shopCss.inspectMetaRow}>
            <span>{row.label}</span>
            <strong data-tone={row.tone}>{row.value}</strong>
          </div>
        ))}
      </div>

      {alert && <p className={shopCss.inspectAlert}>{alert}</p>}

      <div className={shopCss.inspectActions}>
        <Button primary disabled={actionDisabled} reason={actionReason} onClick={onAction}>
          {actionLabel}
        </Button>
      </div>
    </aside>
  );
}

/** 商店终端：左栏货架/回收筛选列表，右栏粘性检视台；不调用模型，按投影报价即时结算 */
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
  const [mode, setMode] = useState<ShopMode>("buy");
  const [category, setCategory] = useState<string>("all");
  const [rarityFilter, setRarityFilter] = useState<string>("all");
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState<{ readonly mode: ShopMode; readonly id: string } | null>(() =>
    shop.shelf[0]
      ? { mode: "buy", id: shop.shelf[0].id }
      : shop.sell[0]
        ? { mode: "sell", id: shop.sell[0].id }
        : null,
  );
  const [confirming, setConfirming] = useState<
    { kind: "buy"; item: ShelfItem } | { kind: "sell"; item: SaleItem } | null
  >(null);
  const [working, setWorking] = useState(false);

  const eddies = view.money.eddies;
  const backpack = view.inventory.backpack;
  const keeperPortrait = portraitOf(shop.keeperNpc);
  const poiIcon: AssetId = shopPoiIconOf(shop.kind);

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
    if (next === mode) return;
    setMode(next);
    setCategory("all");
  };

  const normalizedQuery = query.trim().toLowerCase();

  const categories = useMemo(() => {
    const source = mode === "buy" ? shop.shelf : shop.sell;
    const seen = new Set<string>();
    const list: string[] = [];
    for (const item of source) {
      if (!seen.has(item.group)) {
        seen.add(item.group);
        list.push(item.group);
      }
    }
    return list;
  }, [mode, shop.shelf, shop.sell]);

  const effectiveCategory = category !== "all" && categories.includes(category) ? category : "all";

  const hasIconic = useMemo(() => {
    const source = mode === "buy" ? shop.shelf : shop.sell;
    return source.some((item) => item.iconic);
  }, [mode, shop.shelf, shop.sell]);

  const effectiveRarity = rarityFilter === "iconic" && !hasIconic ? "all" : rarityFilter;

  const filteredShelf = useMemo(() => {
    return shop.shelf.filter((item) => {
      if (effectiveCategory !== "all" && item.group !== effectiveCategory) return false;
      if (!matchesRarity(item, effectiveRarity)) return false;
      if (onlyAvailable && (item.locked !== null || item.left <= 0 || item.price > eddies)) {
        return false;
      }
      return matchesQuery(item, normalizedQuery);
    });
  }, [shop.shelf, effectiveCategory, effectiveRarity, onlyAvailable, eddies, normalizedQuery]);

  const filteredSell = useMemo(() => {
    return shop.sell.filter((item) => {
      if (effectiveCategory !== "all" && item.group !== effectiveCategory) return false;
      if (!matchesRarity(item, effectiveRarity)) return false;
      if (onlyAvailable && (item.locked !== null || item.value <= 0)) return false;
      return matchesQuery(item, normalizedQuery);
    });
  }, [shop.sell, effectiveCategory, effectiveRarity, onlyAvailable, normalizedQuery]);

  const groupedShelf = useMemo(() => byGroup(filteredShelf), [filteredShelf]);
  const groupedSell = useMemo(() => byGroup(filteredSell), [filteredSell]);

  const inspectedBuy =
    mode === "buy"
      ? (filteredShelf.find((i) => focus?.mode === "buy" && i.id === focus.id) ?? filteredShelf[0])
      : undefined;

  const inspectedSell =
    mode === "sell"
      ? (filteredSell.find((i) => focus?.mode === "sell" && i.id === focus.id) ?? filteredSell[0])
      : undefined;

  const renderInspector = () => {
    if (mode === "buy") {
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

      return (
        <ShopInspector
          id={item.id}
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
          fallbackIcon={poiIcon}
          rows={[
            {
              label: "货架标价",
              value: `${money(item.price)} 欧元`,
              tone: short ? "bad" : "yellow",
            },
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
                ? `差 ${money(item.price - eddies)} 欧元`
                : `${money(eddies - item.price)} 欧元`,
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
    const rows: InspectorMetaRow[] = [
      {
        label: "回收报价",
        value: sellPriceLabel(item),
        tone: unavailable ? "bad" : "cyan",
      },
      { label: "背包已有", value: `${owned} 件`, tone: "cyan" },
      ...(unavailable
        ? []
        : [
            {
              label: "卖后余额",
              value: `${money(eddies + item.value)} 欧元`,
              tone: "yellow" as const,
            },
          ]),
    ];

    return (
      <ShopInspector
        id={item.id}
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
        fallbackIcon="notify.inventory"
        rows={rows}
        alert={item.locked ?? (item.value <= 0 ? "这家店不收购此类物品。" : null)}
        actionLabel={unavailable ? "暂不可出手" : `卖出一件（+${money(item.value)} 欧元）`}
        actionDisabled={!onSell || working || unavailable}
        actionReason={item.locked ?? (item.value <= 0 ? "这家店不收" : undefined)}
        onAction={() => setConfirming({ kind: "sell", item })}
      />
    );
  };

  return (
    <div className={shopCss.backdrop}>
      <div role="dialog" aria-label={shop.name} className={shopCss.modal}>
        <Panel as="div" title={`商店 · ${shop.name}`} line="var(--cp-yellow)" frame>
          <div className={shopCss.shell}>
            {/* 顶部商贩横幅 */}
            <header className={shopCss.head}>
              <div className={shopCss.identity}>
                <div className={shopCss.keeperFrame}>
                  <CellFrame />
                  {keeperPortrait ? (
                    <Asset id={keeperPortrait} height={56} alt={shop.keeper} />
                  ) : (
                    <Asset
                      id={poiIcon}
                      height={28}
                      tint="var(--cp-yellow)"
                      className={shopCss.poiIcon}
                    />
                  )}
                </div>

                <div className={shopCss.titleBlock}>
                  <div className={shopCss.titleRow}>
                    <h3>{shop.name}</h3>
                    <p>{shop.note}</p>
                  </div>
                  <div className={shopCss.tags}>
                    <span className={shopCss.tag}>
                      店主 {shop.keeper}
                      {shop.keeperAffinity !== null ? ` · 好感 ${shop.keeperAffinity}` : ""}
                    </span>
                    {shop.blackMarket && (
                      <span className={shopCss.tagBlackMarket}>黑市货源 · 来路不明</span>
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
              </div>

              <div className={shopCss.headActions}>
                <div className={shopCss.eddiesBadge}>
                  <CellFrame />
                  <Asset id="notify.cash" height={16} tint="var(--cp-yellow)" />
                  <span>欧元</span>
                  <span className={shopCss.eddiesValue}>{money(eddies)}</span>
                </div>
                <Button small onClick={onClose}>
                  离开
                </Button>
              </div>
            </header>

            {/* 模式切换与筛选工具栏 */}
            <nav className={shopCss.toolbar} aria-label="商店模式与货架筛选">
              <div className={shopCss.modeTabs} role="tablist" aria-label="交易模式">
                <button
                  type="button"
                  role="tab"
                  className={shopCss.modeTab}
                  aria-selected={mode === "buy"}
                  onClick={() => switchMode("buy")}
                >
                  买进货架（{shop.shelf.length}）
                </button>
                <button
                  type="button"
                  role="tab"
                  className={shopCss.modeTab}
                  aria-selected={mode === "sell"}
                  onClick={() => switchMode("sell")}
                >
                  出手回收（{shop.sell.length}）
                </button>
              </div>

              {categories.length > 0 && (
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
              )}

              <div className={shopCss.filterRow}>
                <div className={shopCss.rarityChips}>
                  <button
                    type="button"
                    className={shopCss.rarityChip}
                    aria-pressed={effectiveRarity === "all"}
                    onClick={() => setRarityFilter("all")}
                  >
                    全稀有度
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
                      不朽
                    </button>
                  )}
                  <button
                    type="button"
                    className={shopCss.toggleChip}
                    aria-pressed={onlyAvailable}
                    onClick={() => setOnlyAvailable((v) => !v)}
                  >
                    {mode === "buy" ? "仅看可买" : "仅看可收"}
                  </button>
                </div>

                <div className={shopCss.searchCell}>
                  <CellFrame />
                  <input
                    type="search"
                    className={shopCss.searchInput}
                    aria-label={
                      mode === "buy" ? "检索商品名称、品类或效果" : "检索背包物品名称、品类或效果"
                    }
                    placeholder={
                      mode === "buy" ? "检索商品名 / 品类 / 效果…" : "检索背包物品 / 品类 / 效果…"
                    }
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
              </div>
            </nav>

            {/* 双栏主体：左货架/回收，右粘性检视台 */}
            <div className={shopCss.body}>
              <div className={shopCss.catalog}>
                {mode === "buy" ? (
                  groupedShelf.length === 0 ? (
                    <div className={shopCss.emptyState}>
                      {shop.shelf.length === 0
                        ? "这家店的货架目前是空的。"
                        : "当前筛选条件没有匹配的商品。"}
                    </div>
                  ) : (
                    groupedShelf.map(([group, items]) => (
                      <section key={group} className={shopCss.groupSection}>
                        <h3 className={shopCss.groupHead}>
                          <span>{group}</span>
                          <span>{items.length}</span>
                        </h3>
                        <ul className={shopCss.cardList}>
                          {items.map((item) => {
                            const short = item.price > eddies;
                            const owned = backpack[item.id] ?? 0;
                            return (
                              <ShopCatalogCard
                                key={item.id}
                                id={item.id}
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
                                priceText={`${money(item.price)} 欧元`}
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
                    {shop.sell.length === 0
                      ? "背包是空的，身上穿着或快捷栏里的物品需先卸下才能出手。"
                      : "当前筛选条件没有匹配的背包物品。"}
                  </div>
                ) : (
                  groupedSell.map(([group, items]) => (
                    <section key={group} className={shopCss.groupSection}>
                      <h3 className={shopCss.groupHead}>
                        <span>{group}</span>
                        <span>{items.length}</span>
                      </h3>
                      <ul className={shopCss.cardList}>
                        {items.map((s) => {
                          const unavailable = s.locked !== null || s.value <= 0;
                          return (
                            <ShopCatalogCard
                              key={s.id}
                              id={s.id}
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
              <p className={shopCss.dialogSummary}>
                {[
                  confirming.item.group,
                  rarityLabelOf(confirming.item.rarity, confirming.item.iconic) ??
                    confirming.item.rarityLabel,
                  confirming.item.subLabel !== confirming.item.group
                    ? confirming.item.subLabel
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                ，买下后放进背包。
              </p>
              {confirming.item.ability && (
                <p className={shopCss.dialogSummary}>{confirming.item.ability}</p>
              )}
              <div className={shopCss.dialogMeta}>
                <span>
                  商品标价：<strong>{money(confirming.item.price)} 欧元</strong>
                </span>
                <span>
                  买后余额：
                  <strong data-tone={eddies - confirming.item.price < 0 ? "bad" : undefined}>
                    {money(eddies - confirming.item.price)} 欧元
                  </strong>
                </span>
              </div>
            </>
          ) : (
            <>
              <p className={shopCss.dialogSummary}>
                {[
                  confirming.item.group,
                  rarityLabelOf(confirming.item.rarity, confirming.item.iconic) ??
                    confirming.item.rarityLabel,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                。店里按参考价的两成收购，卖出后不可撤回。
              </p>
              {confirming.item.ability && (
                <p className={shopCss.dialogSummary}>{confirming.item.ability}</p>
              )}
              <div className={shopCss.dialogMeta}>
                <span>
                  回收所得：<strong>+{money(confirming.item.value)} 欧元</strong>
                </span>
                <span>
                  卖后余额：<strong>{money(eddies + confirming.item.value)} 欧元</strong>
                </span>
              </div>
            </>
          )}
        </Dialog>
      )}
    </div>
  );
}
