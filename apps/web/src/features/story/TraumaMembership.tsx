import type { PlayerAction } from "@cp/core";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Asset } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { CellFrame } from "../../ui/FrameBox";
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
const PLAN_DETAILS = {
  silver: { code: "SILVER", dispatch: "交火结束后出勤", dying: "不含濒死救援" },
  platinum: { code: "PLATINUM", dispatch: "交火期间可出勤", dying: "包含濒死抢救" },
} as const;

function purchaseLabel(offer: TraumaOffer): string {
  if (offer.action === "renew") return `续期${offer.tierLabel}`;
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
  const hasQuote = offer.quoteValid && !downgrade;
  const insufficientFunds =
    hasQuote && shortfall > 0 && offer.reason?.startsWith("余额不足") === true;

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
        <Panel as="div" line="var(--cp-red-dim)" className={styles.frame}>
          <div className={styles.shell}>
            <header className={styles.header}>
              <div className={styles.brand}>
                <Asset
                  id="brand.traumaTeam"
                  height={36}
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
                  <div className={styles.account}>
                    <div className={styles.accountInfo}>
                      <span className={styles.metaLabel}>当前会籍</span>
                      <strong className={styles.accountTier}>
                        {trauma.active ? trauma.tierLabel : trauma.lapsed ? "已到期" : "未开通"}
                      </strong>
                      {trauma.active && trauma.until ? (
                        <time className={styles.accountTerm}>有效至 {trauma.until}</time>
                      ) : trauma.lapsed ? (
                        <span className={styles.accountTerm}>{trauma.lapsed} 到期</span>
                      ) : null}
                    </div>
                    {trauma.active && (
                      <span
                        className={styles.coverage}
                        data-blocked={!trauma.coverage.ok || undefined}
                        title={trauma.coverage.why}
                      >
                        {trauma.coverage.ok ? "保障待命" : "当前救援受限"}
                      </span>
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

                  <fieldset className={styles.plans}>
                    <legend className={styles.plansLegend}>选择保障方案</legend>
                    <div className={styles.planGrid}>
                      {trauma.offers.map((plan) => (
                        <button
                          key={plan.tier}
                          type="button"
                          className={styles.planCard}
                          data-tier={plan.tier}
                          aria-pressed={selectedTier === plan.tier}
                          disabled={pending !== null}
                          onClick={() => {
                            setSelectedTier(plan.tier);
                            setError(null);
                          }}
                        >
                          <CellFrame />
                          <span className={styles.planTop}>
                            <span className={styles.planCode}>{PLAN_DETAILS[plan.tier].code}</span>
                            <span className={styles.planSelection}>
                              {selectedTier === plan.tier ? "✓ 已选" : ""}
                            </span>
                          </span>
                          <span className={styles.planHeading}>
                            <span className={styles.planName}>{plan.tierLabel}</span>
                            {trauma.active && trauma.tier === plan.tier && (
                              <span className={styles.currentPlan}>当前会籍</span>
                            )}
                          </span>
                          <span className={styles.planRate}>
                            <span className={styles.currency}>€$</span>
                            <strong>{money(trauma.prices[plan.tier])}</strong>
                            <span className={styles.period}>/ 30 天</span>
                          </span>
                          <span className={styles.planFeatures}>
                            <span className={styles.feature}>
                              <span>出勤</span>
                              <strong>{PLAN_DETAILS[plan.tier].dispatch}</strong>
                            </span>
                            <span className={styles.feature}>
                              <span>濒死救援</span>
                              <strong>{PLAN_DETAILS[plan.tier].dying}</strong>
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </fieldset>

                  <div className={styles.contract}>
                    {hasQuote && (
                      <>
                        <p className={styles.contractDate}>
                          <span>
                            {offer.action === "upgrade" ? "保留到期日" : "本次办理后有效至"}
                          </span>
                          <time>{offer.until}</time>
                        </p>
                        <p className={styles.termNote}>
                          {offer.action === "upgrade"
                            ? "按剩余每 30 天补差，不足一期按一期；不延长有效期。"
                            : offer.action === "renew"
                              ? "在当前到期日后顺延 30 天，剩余有效期保留。"
                              : "支付后立即生效 · 有效期按游戏时间计算 · 不自动续费"}
                        </p>
                      </>
                    )}
                    {pending === null && unavailableReason && !insufficientFunds && (
                      <p className={styles.notice} data-tone="bad" role="status">
                        {unavailableReason}
                      </p>
                    )}
                  </div>

                  <details className={styles.details}>
                    <summary>
                      保障须知
                      <span>服务限制、救援记录与退会</span>
                    </summary>
                    <div className={styles.detailsBody}>
                      <p>
                        恶土、狗镇与暴恐机动队出动期间不提供救援；银卡不承保濒死。救援仅稳定生命体征，伤口、断肢和损坏义体仍需后续处理。
                      </p>
                      <p>
                        会籍不自动续费；续期最多预缴十二期。升级按剩余每 30 天补差{" "}
                        {money(trauma.prices.platinum - trauma.prices.silver)}
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
              {screen === "plans" ? (
                <div className={styles.checkout}>
                  <div className={styles.total}>
                    <span className={styles.metaLabel}>
                      {offer.action === "upgrade" ? "本次升级补差" : "本次应付"}
                    </span>
                    <strong className={styles.totalValue}>
                      {hasQuote ? `€$ ${money(offer.price)}` : "—"}
                    </strong>
                  </div>
                  <span className={styles.balance}>
                    余额 €$ {money(wallet.eddies)}
                    {insufficientFunds && (
                      <strong className={styles.shortfall}>还差 €$ {money(shortfall)}</strong>
                    )}
                  </span>
                </div>
              ) : (
                <span className={styles.balance}>余额 €$ {money(wallet.eddies)}</span>
              )}
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
                  <Button
                    primary
                    disabled={locked || !hasQuote || !offer.available}
                    reason={unavailableReason ?? undefined}
                    onClick={pay}
                  >
                    {pending && pending !== "rescue"
                      ? "正在办理…"
                      : !hasQuote
                        ? "当前不可办理"
                        : insufficientFunds
                          ? "余额不足"
                          : !offer.available
                            ? "当前不可办理"
                            : `确认${paymentLabel}`}
                  </Button>
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
