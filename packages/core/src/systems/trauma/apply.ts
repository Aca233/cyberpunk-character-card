import type { Draft } from "immer";
import type { ApplyOutcome, SystemContext, TimeSpan } from "../../kernel/system";
import type { CombatState } from "../combat";
import type { EconomyState } from "../economy";
import type { HealthState } from "../health";
import type { HeatState } from "../heat";
import { locationCatalog, type WorldClockState } from "../world";
import {
  TRAUMA_EXCLUDED_DISTRICTS,
  TRAUMA_MAX_PREPAID,
  TRAUMA_MAXTAC_STARS,
  TRAUMA_PERIOD,
  TRAUMA_PRICES,
  TRAUMA_TIER_LABELS,
  type TraumaCommand,
  type TraumaState,
  type TraumaTier,
} from "./schema";

export interface DispatchInput {
  readonly tier: TraumaTier;
  readonly active: boolean;
  readonly condition: HealthState["condition"];
  readonly inCombat: boolean;
  readonly district: string | null;
  readonly stars: number;
}

/** 实际救援资格；健康时的保障待命由投影以假设倒地的状态另行核对。 */
export function dispatchCheck(input: DispatchInput): {
  readonly ok: boolean;
  readonly why: string;
} {
  if (input.tier === "none" || !input.active) return { ok: false, why: "没有有效的会籍" };
  if (input.district === null) return { ok: false, why: "当前位置未确认，无法定位救援" };
  if (TRAUMA_EXCLUDED_DISTRICTS.includes(input.district))
    return { ok: false, why: `${input.district}创伤小组不进` };
  if (input.stars >= TRAUMA_MAXTAC_STARS) return { ok: false, why: "暴恐机动队出动时创伤小组不来" };
  if (input.condition === "up") return { ok: false, why: "生命体征稳定，尚不需要紧急救援" };
  if (input.condition === "dead") return { ok: false, why: "已经死亡，无法通过会员救援复活" };
  if (input.tier === "silver") {
    if (input.condition === "dying") return { ok: false, why: "银卡只救倒下，救不了濒死" };
    if (input.inCombat) return { ok: false, why: "银卡要等交火结束才来" };
  }
  return { ok: true, why: "符合现场紧急救援条件" };
}

const fail = (reason: string): ApplyOutcome => ({ ok: false, reason });

export function isActive(state: Pick<TraumaState, "tier" | "paidUntil">, now: number): boolean {
  return state.tier !== "none" && state.paidUntil !== null && state.paidUntil > now;
}

type MembershipTier = Exclude<TraumaTier, "none">;
export type TraumaPurchase = "join" | "renew" | "upgrade";
export type TraumaQuote =
  | {
      readonly ok: true;
      readonly price: number;
      readonly label: string;
      readonly tier: MembershipTier;
      readonly paidUntil: number;
    }
  | { readonly ok: false; readonly reason: string };

/** 面板、叙事授权和实际扣费共用的纯报价；升级按剩余的每一期补差，余期不丢失。 */
export function quoteTraumaMembership(
  state: Pick<TraumaState, "tier" | "paidUntil">,
  action: TraumaPurchase,
  requestedTier: MembershipTier | undefined,
  now: number,
): TraumaQuote {
  const active = isActive(state, now);
  const tier = requestedTier ?? (state.tier === "none" ? undefined : state.tier);
  if (!Number.isSafeInteger(now)) return { ok: false, reason: "当前游戏时间无效" };
  if (action === "join") {
    if (active)
      return {
        ok: false,
        reason:
          state.tier === tier
            ? "已有有效会籍，请选择续费"
            : "有效期内不能降级或重办，请选择升级或等待到期",
      };
    if (!tier) return { ok: false, reason: "请选择银卡或白金卡" };
    const paidUntil = now + TRAUMA_PERIOD;
    if (!Number.isSafeInteger(paidUntil)) return { ok: false, reason: "会籍到期时间超出范围" };
    return {
      ok: true,
      price: TRAUMA_PRICES[tier],
      label: `开通${TRAUMA_TIER_LABELS[tier]} 30 天`,
      tier,
      paidUntil,
    };
  }
  if (!active || state.tier === "none" || state.paidUntil === null)
    return { ok: false, reason: "没有有效会籍，请重新开通" };
  if (action === "renew") {
    if (tier !== state.tier) return { ok: false, reason: "续费只能延长当前档位；升白金请选择升级" };
    const paidUntil = state.paidUntil + TRAUMA_PERIOD;
    if (!Number.isSafeInteger(paidUntil) || paidUntil - now > TRAUMA_MAX_PREPAID)
      return { ok: false, reason: "最多预付十二期，请在保障余期减少后续费" };
    return {
      ok: true,
      price: TRAUMA_PRICES[state.tier],
      label: `${TRAUMA_TIER_LABELS[state.tier]}续费 30 天`,
      tier: state.tier,
      paidUntil,
    };
  }
  if (state.tier !== "silver" || (requestedTier !== undefined && requestedTier !== "platinum"))
    return { ok: false, reason: "只有有效银卡可以升级为白金卡" };
  const periods = Math.ceil((state.paidUntil - now) / TRAUMA_PERIOD);
  if (!Number.isSafeInteger(periods) || periods < 1 || periods > 12)
    return { ok: false, reason: "会籍余期超出可升级范围" };
  return {
    ok: true,
    price: (TRAUMA_PRICES.platinum - TRAUMA_PRICES.silver) * periods,
    label: "银卡升级白金卡",
    tier: "platinum",
    paidUntil: state.paidUntil,
  };
}

/** 办理不能事后补买保单；伤势稳定且离开交火后才可开通、续费或升级。 */
export function membershipBlock(
  condition: HealthState["condition"],
  inCombat: boolean,
): string | null {
  if (condition !== "up") return "当前无法办理会籍：需要先稳定生命体征，不能倒下后补买救援";
  if (inCombat) return "交火中不能办理会籍，请先脱离战斗";
  return null;
}

export function applyTrauma(
  draft: Draft<TraumaState>,
  command: TraumaCommand,
  ctx: SystemContext,
): ApplyOutcome {
  const health = ctx.read<HealthState>("health");
  const inCombat = ctx.read<CombatState>("combat").active !== null;
  if (command.action === "join" || command.action === "renew" || command.action === "upgrade") {
    const blocked = membershipBlock(health.condition, inCombat);
    if (blocked) return fail(blocked);
    const quote = quoteTraumaMembership(draft, command.action, command.tier, ctx.now);
    if (!quote.ok) return fail(quote.reason);
    const eddies = ctx.read<EconomyState>("economy").eddies;
    if (eddies < quote.price)
      return fail(`${quote.label}需要 ${quote.price} 欧元，身上只有 ${eddies}`);
    draft.tier = quote.tier;
    draft.paidUntil = quote.paidUntil;
    draft.lapsedAt = null;
    return {
      ok: true,
      notes: [`${quote.label}，支付 ${quote.price} 欧元（${command.reason}）`],
      emit: [{ type: "money", delta: -quote.price, reason: `创伤小组${quote.label}` }],
    };
  }
  if (command.action === "cancel") {
    if (!isActive(draft, ctx.now)) return fail("没有有效的创伤小组会籍");
    if (health.condition !== "up" || inCombat) return fail("请在生命体征稳定且脱离战斗后退会");
    const label = TRAUMA_TIER_LABELS[draft.tier];
    draft.tier = "none";
    draft.paidUntil = null;
    draft.lapsedAt = null;
    return {
      ok: true,
      notes: [`退掉了创伤小组${label}（${command.reason}），保障立即结束，已付费用不退`],
    };
  }
  const location = ctx.read<WorldClockState>("world").location;
  const district =
    location === null ? null : (locationCatalog(ctx.data).get(location)?.district ?? null);
  const check = dispatchCheck({
    tier: draft.tier,
    active: isActive(draft, ctx.now),
    condition: health.condition,
    inCombat,
    district,
    stars: ctx.read<HeatState>("heat").stars,
  });
  if (!check.ok) return fail(`创伤小组不会来：${check.why}`);
  if (draft.tier === "none") return fail("没有有效的会籍");
  draft.rescues += 1;
  draft.lastRescue = { at: ctx.now, location, tier: draft.tier };
  return {
    ok: true,
    notes: [
      `创伤小组赶到并稳定了你的生命体征（${command.reason}）；伤口仍需恢复，现场位置与交战状态未改变`,
    ],
    emit: [{ type: "health.revive" }],
  };
}

/** 到期不自动扣费；准确记录到期时刻。 */
export function tickTrauma(draft: Draft<TraumaState>, span: TimeSpan): void {
  if (draft.tier !== "none" && draft.paidUntil !== null && draft.paidUntil <= span.to) {
    draft.lapsedAt = draft.paidUntil;
    draft.tier = "none";
    draft.paidUntil = null;
  }
}
