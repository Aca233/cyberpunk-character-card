import type { PlayerAction } from "@cp/core";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { CellFrame } from "../../ui/FrameBox";
import { useLayer } from "../../ui/layers";
import styles from "./trauma-membership.module.css";
import type { View } from "./view";

export type TraumaAction = Extract<PlayerAction, { readonly type: "trauma" }>;

interface Confirmation {
  readonly action: TraumaAction;
  readonly title: string;
  readonly description: string;
  readonly price: number;
  readonly until: string | null;
}

type TraumaOffer = View["trauma"]["offers"][number];

const PLAN_DETAILS = {
  silver: ["交火结束后接应", "可救援倒地失能；不承保濒死抢救"],
  platinum: ["可进入交火现场接应", "承保倒地失能与濒死抢救"],
} as const;

const money = (amount: number) => amount.toLocaleString("en-US");

function offerConfirmation(offer: TraumaOffer): Confirmation {
  return {
    action: { type: "trauma", action: offer.action, tier: offer.tier },
    title: `${offer.label} · ${offer.tierLabel}`,
    description:
      offer.action === "upgrade"
        ? `按剩余每 30 个游戏日一期补齐档位差价，不足一期按一期计算。升级不延长期限，仍保障至 ${offer.until}。`
        : `${offer.action === "renew" ? "在现有有效期之后追加" : "购买"} 30 个游戏日，保障至 ${offer.until}。`,
    price: offer.price,
    until: offer.until,
  };
}

/** 玩家直接管理救援会籍；报价和救援可行性由内核投影提供。 */
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
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  useLayer(() => {
    if (!running.current) onClose();
  }, confirmation === null);
  const locked = busy || pending || !onTrauma;
  const lockedReason =
    busy || pending ? "正在处理行动，请稍候" : "当前无法操作，请先完成当前行动或检查存档状态";

  const submit = async (action: TraumaAction) => {
    if (!onTrauma || busy || running.current) return;
    running.current = true;
    setPending(true);
    setError(null);
    try {
      await onTrauma(action);
      setConfirmation(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作未完成，请核对当前会籍后重试");
    } finally {
      running.current = false;
      setPending(false);
    }
  };

  const ask = (next: Confirmation) => {
    setError(null);
    setConfirmation(next);
  };

  const confirmRequest = () => {
    if (!confirmation || locked) return;
    const action = confirmation.action;
    if (action.action === "cancel") {
      if (!trauma.canCancel) {
        setError(trauma.cancelReason ?? "当前会籍状态已变化，请关闭确认框后重试");
        return;
      }
    } else {
      const offer = trauma.offers.find(
        (candidate) => candidate.action === action.action && candidate.tier === action.tier,
      );
      if (!offer?.available) {
        setError(offer?.reason ?? "当前会籍状态已变化，请关闭确认框后重新选择方案");
        return;
      }
      if (offer.price !== confirmation.price || offer.until !== confirmation.until) {
        setConfirmation(offerConfirmation(offer));
        setError("报价或保障期限已更新，请核对后再次确认");
        return;
      }
    }
    void submit(action);
  };

  return createPortal(
    <>
      <div className={styles.backdrop}>
        <section
          className={styles.root}
          role="dialog"
          aria-modal="true"
          aria-label="创伤小组会员服务"
        >
          <CellFrame />
          <header className={styles.header}>
            <div className={styles.heading}>
              <span className={styles.code}>TRAUMA TEAM INTERNATIONAL</span>
              <h3 className={styles.title}>创伤小组 · 会员服务</h3>
            </div>
            <div className={styles.headerControls}>
              <span className={styles.balance}>
                可用余额 <strong>{money(wallet.eddies)} 欧元</strong>
              </span>
              <Button
                small
                disabled={pending}
                reason="正在办理，请稍候"
                onClick={() => {
                  if (!running.current) onClose();
                }}
              >
                关闭
              </Button>
            </div>
          </header>

          <div className={styles.summary} data-active={trauma.active}>
            <strong>{trauma.active ? `${trauma.tierLabel}会籍生效中` : "未持有有效会籍"}</strong>
            {trauma.active && trauma.until && (
              <span>
                保障至 <time>{trauma.until}</time>
              </span>
            )}
            {!trauma.active && trauma.lapsed && <span>上期已于 {trauma.lapsed} 到期</span>}
            {trauma.active && <span>剩余 {Math.ceil(trauma.remainingMinutes / 60)} 小时</span>}
            <span>累计救援 {trauma.rescues} 次</span>
          </div>

          <div className={styles.plans}>
            {trauma.offers.map((offer) => {
              const current = trauma.active && trauma.tier === offer.tier;
              const reason = locked ? lockedReason : offer.reason;
              return (
                <article className={styles.plan} data-current={current} key={offer.tier}>
                  <div className={styles.planHeader}>
                    <span className={styles.planName}>
                      {offer.tierLabel}
                      {current && <small className={styles.current}>当前方案</small>}
                    </span>
                    <span className={styles.price}>
                      {money(trauma.prices[offer.tier])} 欧元
                      <small className={styles.period}> / 30 个游戏日</small>
                    </span>
                  </div>
                  <ul className={styles.benefits}>
                    {PLAN_DETAILS[offer.tier].map((detail) => (
                      <li key={detail}>{detail}</li>
                    ))}
                  </ul>
                  <div className={styles.actions}>
                    <Button
                      small
                      primary={offer.available}
                      disabled={locked || !offer.available}
                      reason={reason ?? undefined}
                      onClick={() => ask(offerConfirmation(offer))}
                    >
                      {offer.label} · {money(offer.price)} 欧元
                    </Button>
                  </div>
                  {offer.reason && <p className={styles.reason}>{offer.reason}</p>}
                </article>
              );
            })}
          </div>

          <p className={styles.note}>
            会籍不自动续费。恶土、狗镇不在服务范围；暴恐机动队出动时不提供接应。
            救援会稳定伤势，创口、断肢与损坏义体仍需后续治疗。
          </p>

          <div className={styles.rescue}>
            <div className={styles.rescueStatus} data-ready={trauma.coverage.ok}>
              <strong>
                {trauma.rescue.ok
                  ? "紧急救援可出动"
                  : trauma.coverage.ok
                    ? "救援保障待命"
                    : "当前无法出动"}
              </strong>
              <p className={styles.note}>
                {trauma.rescue.ok ? "已满足紧急救援条件，可呼叫创伤小组。" : trauma.rescue.why}
              </p>
            </div>
            {trauma.rescue.ok && (
              <Button
                small
                primary={trauma.rescue.ok}
                disabled={locked || !trauma.rescue.ok}
                reason={locked ? lockedReason : trauma.rescue.why}
                onClick={() => void submit({ type: "trauma", action: "rescue" })}
              >
                {pending ? "处理中…" : "呼叫紧急救援"}
              </Button>
            )}
          </div>

          <footer className={styles.footer}>
            <p className={styles.note}>
              {trauma.lastRescue
                ? `最近救援：${trauma.lastRescue.at}${trauma.lastRescue.location ? ` · ${trauma.lastRescue.location}` : ""}`
                : "尚无救援记录"}
            </p>
            {trauma.active && (
              <Button
                small
                disabled={locked || !trauma.canCancel}
                reason={locked ? lockedReason : (trauma.cancelReason ?? undefined)}
                onClick={() =>
                  ask({
                    action: { type: "trauma", action: "cancel" },
                    title: "终止创伤小组会籍",
                    description: "确认后立即失去当前救援保障，剩余有效期不保留，已付费用不退还。",
                    price: 0,
                    until: null,
                  })
                }
              >
                终止会籍
              </Button>
            )}
          </footer>

          {error && !confirmation && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </section>
      </div>

      {confirmation && (
        <Dialog
          title={confirmation.title}
          tone={confirmation.action.action === "cancel" ? "danger" : "info"}
          onClose={() => {
            if (!running.current) setConfirmation(null);
          }}
          actions={
            <>
              <Button primary disabled={locked} reason={lockedReason} onClick={confirmRequest}>
                {pending ? "处理中…" : "确认"}
              </Button>
              <Button
                disabled={pending}
                onClick={() => {
                  if (!running.current) setConfirmation(null);
                }}
              >
                再想想
              </Button>
            </>
          }
        >
          <div className={styles.confirmation}>
            <p>{confirmation.description}</p>
            {confirmation.price > 0 && (
              <p className={styles.charge}>
                本次支付 {money(confirmation.price)} 欧元 · 当前余额 {money(wallet.eddies)} 欧元
              </p>
            )}
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
          </div>
        </Dialog>
      )}
    </>,
    document.body,
  );
}
