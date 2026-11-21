import { type CSSProperties, useMemo, useState } from "react";
import { Asset, cssUrl } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { CellFrame } from "../../ui/FrameBox";
import { useLayer } from "../../ui/layers";
import { Panel } from "../../ui/Panel";
import shopCss from "./shop.module.css";
import { vehicleArtOf } from "./vehicle-art";
import type { View } from "./view";

type AutofixerView = NonNullable<View["travel"]["autofixer"]>;
type AutofixerVehicle = AutofixerView["vehicles"][number];

const CLASS_ORDER = ["all", "economy", "executive", "sport", "hyper", "offroad", "moto"] as const;
type ClassFilter = (typeof CLASS_ORDER)[number];

const CLASS_FILTER_LABELS: Readonly<Record<ClassFilter, string>> = {
  all: "全部",
  economy: "经济型",
  executive: "行政型",
  sport: "运动型",
  hyper: "超跑",
  offroad: "越野",
  moto: "摩托",
};

const CARD_FOCUS_BTN_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flex: "1 1 12rem",
  minWidth: 0,
  padding: 0,
  border: 0,
  background: "none",
  color: "inherit",
  font: "inherit",
  textAlign: "left",
  cursor: "inherit",
};

/** 好车中间人终端：照商店双栏布局展示当前片区可购车型并支持一键购车交付到场 */
export function AutofixerModal({
  view,
  terminal,
  onBuy,
  onClose,
}: {
  readonly view: View;
  readonly terminal: AutofixerView;
  readonly onBuy?: ((model: string) => Promise<void>) | undefined;
  readonly onClose: () => void;
}) {
  const [filter, setFilter] = useState<ClassFilter>("all");
  const [onlyAffordable, setOnlyAffordable] = useState(false);
  const [confirm, setConfirm] = useState<AutofixerVehicle | null>(null);
  const [busy, setBusy] = useState(false);
  const eddies = view.money.eddies;

  useLayer(onClose, !confirm);

  const classes = useMemo(() => {
    const present = new Set(terminal.vehicles.map((v) => v.class));
    return CLASS_ORDER.filter((c) => c === "all" || present.has(c));
  }, [terminal.vehicles]);

  const list = useMemo(
    () =>
      terminal.vehicles.filter((v) => {
        if (filter !== "all" && v.class !== filter) return false;
        if (onlyAffordable && eddies < v.price) return false;
        return true;
      }),
    [terminal.vehicles, filter, onlyAffordable, eddies],
  );

  const [focusId, setFocusId] = useState<string | null>(terminal.vehicles[0]?.id ?? null);
  const focused = list.find((v) => v.id === focusId) ?? list[0] ?? null;
  const focusedArt = focused ? vehicleArtOf(focused.id) : undefined;

  const submitBuy = async (car: AutofixerVehicle) => {
    if (!onBuy || busy) return;
    setBusy(true);
    try {
      await onBuy(car.id);
      setConfirm(null);
    } catch {
      // 失败原因由外层吐司提示
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={shopCss.backdrop} role="dialog" aria-modal aria-label={terminal.name}>
      <div className={shopCss.modal}>
        <Panel as="div" title="好车中间人终端" line="var(--cp-yellow)" frame>
          <div className={shopCss.shell}>
            <header className={shopCss.head}>
              <div className={shopCss.identity}>
                <span className={shopCss.poiIcon}>
                  <Asset id="map.poi.autofixer" height={28} tint="currentColor" />
                </span>
                <div className={shopCss.titleBlock}>
                  <div className={shopCss.titleRow}>
                    <h2>{terminal.name}</h2>
                    <span className={shopCss.tag}>AUTOFIXER</span>
                  </div>
                  <div className={shopCss.titleRow}>
                    <p>一次付清后自动驶抵当前停靠点，可直接在装备栏查看后备箱与远程呼叫。</p>
                  </div>
                </div>
              </div>
              <div className={shopCss.headActions}>
                <div className={shopCss.eddiesBadge}>
                  <CellFrame />
                  <Asset id="notify.cash" tint="var(--cp-yellow)" height={13} />
                  <span>随身欧元</span>
                  <strong className={shopCss.eddiesValue}>
                    {eddies.toLocaleString("en-US")} €
                  </strong>
                </div>
                <Button small onClick={onClose}>
                  关闭
                </Button>
              </div>
            </header>

            <div className={shopCss.toolbar}>
              <div className={shopCss.filterRow}>
                <div className={shopCss.catTabs}>
                  {classes.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={shopCss.catTab}
                      aria-pressed={filter === c}
                      onClick={() => setFilter(c)}
                    >
                      {CLASS_FILTER_LABELS[c]}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className={shopCss.toggleChip}
                  aria-pressed={onlyAffordable}
                  onClick={() => setOnlyAffordable((v) => !v)}
                >
                  仅看买得起
                </button>
              </div>
            </div>

            <div className={shopCss.body}>
              <div className={shopCss.catalog}>
                {list.length === 0 ? (
                  <p className={shopCss.emptyState}>这个筛选条件下暂无可购车型。</p>
                ) : (
                  <ul className={shopCss.cardList}>
                    {list.map((car) => {
                      const art = vehicleArtOf(car.id);
                      const canAfford = eddies >= car.price;
                      const active = focused?.id === car.id;
                      return (
                        <li
                          key={car.id}
                          className={shopCss.itemCard}
                          data-active={active || undefined}
                          style={
                            {
                              "--item-tint": canAfford ? "var(--cp-yellow)" : "var(--cp-red)",
                            } as CSSProperties
                          }
                        >
                          <CellFrame />
                          <button
                            type="button"
                            style={CARD_FOCUS_BTN_STYLE}
                            onClick={() => setFocusId(car.id)}
                          >
                            <span className={shopCss.thumbBox}>
                              {art ? (
                                <Asset id={art} className={shopCss.thumbImg} />
                              ) : (
                                <Asset id="map.poi.autofixer" height={24} tint="var(--cp-yellow)" />
                              )}
                            </span>
                            <span className={shopCss.itemBody}>
                              <span className={shopCss.itemTitleRow}>
                                <strong className={shopCss.itemName}>{car.name}</strong>
                                {car.owned && <span className={shopCss.ownedPill}>名下已有</span>}
                              </span>
                              <span className={shopCss.itemMeta}>
                                {[
                                  car.maker,
                                  car.classLabel,
                                  `速度 ${car.speed}/5`,
                                  `${car.seats} 座`,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </span>
                            </span>
                          </button>
                          <div className={shopCss.itemAside}>
                            <span className={shopCss.priceTag} data-short={!canAfford || undefined}>
                              {car.price.toLocaleString("en-US")} €
                            </span>
                            <Button
                              small
                              primary={canAfford}
                              disabled={!onBuy || !canAfford || busy}
                              onClick={() => setConfirm(car)}
                            >
                              {canAfford ? "购买" : "余额不足"}
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {focused && (
                <aside
                  className={shopCss.inspector}
                  style={{ "--item-tint": "var(--cp-yellow)" } as CSSProperties}
                >
                  <CellFrame />
                  <div className={shopCss.inspectShowcase}>
                    <CellFrame />
                    <span
                      className={shopCss.inspectGrid}
                      style={{ backgroundImage: cssUrl("fx.grid") }}
                      aria-hidden
                    />
                    {focusedArt ? (
                      <Asset id={focusedArt} className={shopCss.inspectArt} />
                    ) : (
                      <Asset id="map.poi.autofixer" height={54} tint="var(--cp-yellow)" />
                    )}
                  </div>
                  <div className={shopCss.inspectHeader}>
                    <h3>{focused.name}</h3>
                    <p>{[focused.maker, focused.classLabel].filter(Boolean).join(" · ")}</p>
                  </div>
                  <div className={shopCss.inspectTags}>
                    <span className={shopCss.inspectTag} data-tone="yellow">
                      速度档 {focused.speed}/5
                    </span>
                    <span className={shopCss.inspectTag}>{focused.seats} 座</span>
                    {focused.owned && <span className={shopCss.inspectTag}>名下已有同款</span>}
                  </div>
                  {focused.note && <p className={shopCss.inspectAbility}>{focused.note}</p>}
                  <div className={shopCss.inspectMetaGrid}>
                    <div className={shopCss.inspectMetaRow}>
                      <span>车辆售价</span>
                      <strong
                        data-tone={eddies >= focused.price ? "yellow" : "bad"}
                      >{`${focused.price.toLocaleString("en-US")} €`}</strong>
                    </div>
                    <div className={shopCss.inspectMetaRow}>
                      <span>付款后余额</span>
                      <strong
                        data-short={eddies < focused.price || undefined}
                      >{`${(eddies - focused.price).toLocaleString("en-US")} €`}</strong>
                    </div>
                  </div>
                  <div className={shopCss.inspectActions}>
                    <Button
                      primary
                      disabled={!onBuy || eddies < focused.price || busy}
                      onClick={() => setConfirm(focused)}
                    >
                      {eddies >= focused.price ? "买下并交付到场" : "欧元不足"}
                    </Button>
                  </div>
                </aside>
              )}
            </div>
          </div>
        </Panel>
      </div>

      {confirm && (
        <Dialog
          title={`买下 ${confirm.name}`}
          tone="info"
          onClose={() => setConfirm(null)}
          actions={
            <>
              <Button primary disabled={busy} onClick={() => void submitBuy(confirm)}>
                一次付清
              </Button>
              <Button disabled={busy} onClick={() => setConfirm(null)}>
                取消
              </Button>
            </>
          }
        >
          <p>
            {confirm.note ??
              `${confirm.classLabel} · 速度 ${confirm.speed}/5 · ${confirm.seats} 座`}
          </p>
          <p>
            售价 {confirm.price.toLocaleString("en-US")} 欧元，当前余额{" "}
            {eddies.toLocaleString("en-US")} 欧元，付款后剩余{" "}
            {(eddies - confirm.price).toLocaleString("en-US")} 欧元。
          </p>
        </Dialog>
      )}
    </div>
  );
}
