import type { PlayerAction } from "@cp/core";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Asset, NineSlice } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { useLayer } from "../../ui/layers";
import { Panel } from "../../ui/Panel";
import styles from "./trauma-membership.module.css";
import type { View } from "./view";

export type TraumaAction = Extract<PlayerAction, { readonly type: "trauma" }>;
type TraumaOffer = View["trauma"]["offers"][number];
type MembershipTier = TraumaOffer["tier"];
type Screen = "plans" | "cancel" | "receipt";

interface Receipt {
  readonly title: string;
  readonly detail: string;
  readonly price: number;
  readonly until: string | null;
}

const money = (amount: number) => amount.toLocaleString("en-US");
const PLAN_COPY = {
  silver: "交火结束后，救援倒地失能的会员。",
  platinum: "交火中也可介入，提供倒地救援与濒死抢救。",
} as const;

function purchaseLabel(offer: TraumaOffer): string {
  if (offer.action === "renew") return `${offer.tierLabel}续期 30 天`;
  if (offer.action === "upgrade") return "升级为白金卡";
  return `开通${offer.tierLabel}`;
}

/** 按需打开的创伤小组服务终端；明确标价后支付，成交回执取代二次弹窗。 */
export function TraumaMembership({
  view,
  onTrauma,
  busy = false,
  onClose,
}: {
  readonly view: View;
  readonly onTrauma?: ((action: TraumaAction) => Promise<void>) | undefined;
  readonly busy?: boolean | undefined;
  readonly onClose: () => void;
}) {
  const { trauma, money: wallet } = view;
  const [selectedTier, setSelectedTier] = useState<MembershipTier>(
    trauma.active && trauma.tier !== "none" ? trauma.tier : "silver",
  );
  const [screen, setScreen] = useState<Screen>("plans");
  const [pending, setPending] = useState<TraumaAction["action"] | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const screenHeading = useRef<HTMLHeadingElement>(null);
  const titleId = useId();

  const close = () => {
    if (!running.current) onClose();
  };
  useLayer(() => {
    if (running.current) return;
    if (screen === "cancel") {
      setScreen("plans");
      setError(null);
    } else onClose();
  });

  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    if (screen === "plans") closeButton.current?.focus();
    else screenHeading.current?.focus();
  }, [screen]);

  useEffect(() => {
    if (pending !== null) dialog.current?.focus();
  }, [pending]);

  const keepFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const controls = Array.from(
      dialog.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), summary, [href], [tabindex="0"]',
      ) ?? [],
    ).filter((element) => element.getClientRects().length > 0);
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last) {
      event.preventDefault();
      dialog.current?.focus();
      return;
    }
    if (
      event.shiftKey &&
      (document.activeElement === first ||
        !controls.includes(document.activeElement as HTMLElement))
    ) {
      event.preventDefault();
      last.focus();
    } else if (
      !event.shiftKey &&
      (document.activeElement === last || !controls.includes(document.activeElement as HTMLElement))
    ) {
      event.preventDefault();
      first.focus();
    }
  };

  const locked = busy || pending !== null || !onTrauma;
  const lockedReason =
    pending !== null
      ? "正在提交，请稍候"
      : busy
        ? "正在处理行动，请稍候"
        : view.death || view.ended
          ? "故事已结束，会籍仅供查看"
          : "请先完成当前行动，再办理会籍";
  const offer = trauma.offers.find((candidate) => candidate.tier === selectedTier);
  if (!offer) return null;
  const downgrade = trauma.active && trauma.tier === "platinum" && selectedTier === "silver";
  const shortfall = Math.max(0, offer.price - wallet.eddies);
  const unavailableReason = locked
    ? lockedReason
    : downgrade
      ? "你已持有白金卡，有效期内不能降为银卡。"
      : shortfall > 0 && offer.reason?.startsWith("余额不足")
        ? `余额不足，还差 €$ ${money(shortfall)}。`
        : offer.reason;
  const paymentLabel = purchaseLabel(offer);

  const perform = async (action: TraumaAction, nextReceipt: Receipt) => {
    if (!onTrauma || busy || running.current) return;
    running.current = true;
    setPending(action.action);
    setError(null);
    try {
      await onTrauma(action);
      setReceipt(nextReceipt);
      setScreen("receipt");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "办理未完成，请稍后重试");
    } finally {
      running.current = false;
      setPending(null);
    }
  };

  const pay = () => {
    if (locked || !offer.quoteValid || !offer.available || downgrade) return;
    void perform(
      { type: "trauma", action: offer.action, tier: offer.tier },
      {
        title:
          offer.action === "renew"
            ? `${offer.tierLabel}已续期`
            : offer.action === "upgrade"
              ? "已升级为白金卡"
              : `${offer.tierLabel}已开通`,
        detail: "会籍已生效，保障状态已同步至生物监测。",
        price: offer.price,
        until: offer.until,
      },
    );
  };

  const returnToPlans = () => {
    if (running.current) return;
    setScreen("plans");
    setReceipt(null);
    setError(null);
    if (trauma.active && trauma.tier !== "none") setSelectedTier(trauma.tier);
  };

  return createPortal(
    <div className={styles.backdrop}>
      <button
        type="button"
        className={styles.scrim}
        aria-label="关闭创伤小组服务终端"
        tabIndex={-1}
        disabled={pending !== null}
        onClick={close}
      />
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-busy={pending !== null}
        aria-labelledby={titleId}
        tabIndex={-1}
        className={styles.dialog}
        onKeyDown={keepFocus}
      >
        <Panel as="div" frame className={styles.frame}>
          <div className={styles.shell}>
            <header className={styles.header}>
              <div className={styles.brand}>
                <Asset
                  id="map.poi.meds"
                  height={34}
                  tint="var(--cp-red)"
                  className={styles.brandIcon}
                />
                <div>
                  <span className={styles.eyebrow}>TRAUMA TEAM INTERNATIONAL</span>
                  <h2 id={titleId} className={styles.title}>
                    创伤小组
                  </h2>
                </div>
              </div>
              <button
                ref={closeButton}
                type="button"
                className={styles.closeButton}
                disabled={pending !== null}
                onClick={close}
              >
                <kbd>Esc</kbd> 关闭
              </button>
            </header>

            <div className={styles.scrollBody}>
              {screen === "receipt" && receipt ? (
                <section className={styles.receipt} aria-live="polite">
                  <span className={styles.eyebrow}>SERVICE COMPLETE</span>
                  <h3 ref={screenHeading} tabIndex={-1} className={styles.receiptTitle}>
                    {receipt.title}
                  </h3>
                  <p className={styles.receiptText}>{receipt.detail}</p>
                  {receipt.price > 0 && (
                    <p className={styles.receiptText}>
                      已支付 <strong>€$ {money(receipt.price)}</strong>
                    </p>
                  )}
                  {receipt.until && (
                    <p className={styles.receiptText}>
                      保障至 <time>{receipt.until}</time>
                    </p>
                  )}
                </section>
              ) : screen === "cancel" ? (
                <section className={styles.dangerPanel}>
                  <span className={styles.eyebrow}>TERMINATE MEMBERSHIP</span>
                  <h3 ref={screenHeading} tabIndex={-1} className={styles.planName}>
                    {trauma.active ? `终止${trauma.tierLabel}会籍？` : "当前没有可终止的会籍"}
                  </h3>
                  <p className={styles.description}>
                    确认后立即停止救援保障。剩余有效期不保留，已付费用不退还。
                  </p>
                  {trauma.until && <p className={styles.termNote}>当前保障原定至 {trauma.until}</p>}
                  {!trauma.canCancel && (
                    <p className={styles.notice} data-tone="bad">
                      {trauma.cancelReason}
                    </p>
                  )}
                </section>
              ) : (
                <>
                  <div className={styles.statusLine}>
                    <span className={styles.statusBadge}>
                      {trauma.active ? `${trauma.tierLabel}会员` : "尚未开通会籍"}
                    </span>
                    {trauma.active && trauma.until ? (
                      <time>有效至 {trauma.until}</time>
                    ) : trauma.lapsed ? (
                      <span>上期已于 {trauma.lapsed} 到期</span>
                    ) : (
                      <span>选择适合你的救援保障</span>
                    )}
                  </div>

                  {trauma.rescue.ok && (
                    <div className={styles.emergency}>
                      <strong>生命体征告急 · 当前保障可用</strong>
                      <Button
                        primary
                        disabled={locked}
                        reason={lockedReason}
                        onClick={() =>
                          void perform(
                            { type: "trauma", action: "rescue" },
                            {
                              title: "生命体征已稳定",
                              detail: "创伤小组已完成现场急救。具体伤口仍需恢复。",
                              price: 0,
                              until: null,
                            },
                          )
                        }
                      >
                        {pending === "rescue" ? "救援呼叫中…" : "立即呼叫救援"}
                      </Button>
                    </div>
                  )}

                  <fieldset className={styles.tabs} aria-label="选择会员方案">
                    {trauma.offers.map((plan) => (
                      <button
                        key={plan.tier}
                        type="button"
                        className={styles.tab}
                        aria-pressed={selectedTier === plan.tier}
                        disabled={pending !== null}
                        onClick={() => {
                          setSelectedTier(plan.tier);
                          setError(null);
                        }}
                      >
                        <NineSlice
                          id="tab.bg"
                          tint="currentColor"
                          slice={14}
                          className={styles.tabBg}
                        />
                        <span className={styles.tabName}>
                          {plan.tierLabel}
                          {trauma.active && trauma.tier === plan.tier ? " · 当前" : ""}
                        </span>
                        <span className={styles.tabRate}>
                          €$ {money(trauma.prices[plan.tier])} / 30 天
                        </span>
                      </button>
                    ))}
                  </fieldset>

                  <section className={styles.plan} aria-label={`${offer.tierLabel}保障与报价`}>
                    <p className={styles.description}>{PLAN_COPY[selectedTier]}</p>
                    {offer.quoteValid && !downgrade && (
                      <>
                        <dl className={styles.quote}>
                          <div className={styles.quoteRow}>
                            <dt className={styles.quoteLabel}>
                              {offer.action === "upgrade" ? "升级补差" : "本次费用"}
                            </dt>
                            <dd className={styles.quoteValue} data-money>
                              €$ {money(offer.price)}
                            </dd>
                          </div>
                          <div className={styles.quoteRow}>
                            <dt className={styles.quoteLabel}>
                              {offer.action === "upgrade" ? "保留到期日" : "保障至"}
                            </dt>
                            <dd className={styles.quoteValue}>{offer.until}</dd>
                          </div>
                        </dl>
                        <p className={styles.termNote}>
                          {offer.action === "upgrade"
                            ? "按剩余每 30 天补差价，不足一期按一期；不延长到期日。"
                            : offer.action === "renew"
                              ? "在当前到期日后追加 30 天，剩余有效期保留。"
                              : "支付后立即生效，有效期 30 个游戏日。"}
                        </p>
                      </>
                    )}
                    {pending === null && unavailableReason && (
                      <p className={styles.notice} data-tone="bad">
                        {unavailableReason}
                      </p>
                    )}
                  </section>

                  <details className={styles.details}>
                    <summary>保障条款与救援记录</summary>
                    <div className={styles.detailsBody}>
                      <p>
                        恶土、狗镇与暴恐机动队出动期间不提供救援；银卡不承保濒死。救援仅稳定生命体征，伤口、断肢和损坏义体仍需后续处理。
                      </p>
                      <p>
                        会籍不自动续费；续期最多预缴十二期。升级按剩余每 30 天补差 4,000
                        欧元，不足一期按一期。
                      </p>
                      {trauma.lastRescue ? (
                        <p className={styles.history}>
                          累计救援 {trauma.rescues} 次 · 最近一次 {trauma.lastRescue.at}
                          {trauma.lastRescue.location ? `，${trauma.lastRescue.location}` : ""}
                        </p>
                      ) : (
                        <p className={styles.history}>暂无救援记录</p>
                      )}
                      {trauma.active && (
                        <button
                          type="button"
                          className={styles.dangerButton}
                          disabled={locked || !trauma.canCancel}
                          title={trauma.cancelReason ?? undefined}
                          onClick={() => {
                            setScreen("cancel");
                            setError(null);
                          }}
                        >
                          终止会籍
                        </button>
                      )}
                    </div>
                  </details>
                </>
              )}
              {error && (
                <p className={styles.notice} data-tone="bad" role="alert">
                  {error}
                </p>
              )}
            </div>

            <footer className={styles.footer}>
              <div className={styles.wallet}>
                <span>可用余额</span>
                <strong className={styles.walletValue}>€$ {money(wallet.eddies)}</strong>
              </div>
              <div className={styles.footerActions}>
                {screen === "receipt" ? (
                  <>
                    <Button onClick={returnToPlans}>返回会籍</Button>
                    <Button primary onClick={close}>
                      完成
                    </Button>
                  </>
                ) : screen === "cancel" ? (
                  <>
                    <Button disabled={pending !== null} onClick={returnToPlans}>
                      保留会籍
                    </Button>
                    <Button
                      disabled={locked || !trauma.canCancel}
                      reason={trauma.cancelReason ?? lockedReason}
                      onClick={() =>
                        void perform(
                          { type: "trauma", action: "cancel" },
                          {
                            title: "会籍已终止",
                            detail: "当前救援保障已停止，已付费用不退还。",
                            price: 0,
                            until: null,
                          },
                        )
                      }
                    >
                      {pending === "cancel" ? "正在退会…" : "确认退会"}
                    </Button>
                  </>
                ) : (
                  <>
                    <span className={styles.footerHint}>确认支付即办理 · 不自动续费</span>
                    <Button
                      primary
                      disabled={locked || !offer.quoteValid || !offer.available || downgrade}
                      reason={unavailableReason ?? undefined}
                      onClick={pay}
                    >
                      {pending && pending !== "rescue"
                        ? "正在办理…"
                        : !offer.quoteValid
                          ? "当前不可办理"
                          : `${paymentLabel} · 支付 €$ ${money(offer.price)}`}
                    </Button>
                  </>
                )}
              </div>
            </footer>
          </div>
        </Panel>
      </div>
    </div>,
    document.body,
  );
}
