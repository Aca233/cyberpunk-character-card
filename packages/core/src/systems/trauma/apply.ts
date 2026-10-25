import type { Draft } from "immer";
import type { ApplyOutcome, SystemContext, TimeSpan } from "../../kernel/system";
import type { CombatState } from "../combat";
import type { EconomyState } from "../economy";
import type { HealthState } from "../health";
import type { HeatState } from "../heat";
import { locationCatalog, type WorldClockState } from "../world";
import {
  TRAUMA_EXCLUDED_DISTRICTS,
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

/** 创伤小组现在来不来；ok 为 false 时 why 写原因。银卡交火结束后来、只救倒下，白金卡交火中也来、能救濒死 */
export function dispatchCheck(input: DispatchInput): {
  readonly ok: boolean;
  readonly why: string;
} {
  if (input.tier === "none" || !input.active) return { ok: false, why: "没有有效的会籍" };
  if (input.district !== null && TRAUMA_EXCLUDED_DISTRICTS.includes(input.district))
    return { ok: false, why: `${input.district}创伤小组不进` };
  if (input.stars >= TRAUMA_MAXTAC_STARS) return { ok: false, why: "暴恐机动队出动时创伤小组不来" };
  if (input.condition === "up") return { ok: false, why: "没倒下，用不着" };
  if (input.condition === "dead") return { ok: false, why: "人已经死了" };
  if (input.tier === "silver") {
    if (input.condition === "dying") return { ok: false, why: "银卡只救倒下，救不了濒死" };
    if (input.inCombat) return { ok: false, why: "银卡要等交火结束才来" };
  }
  return { ok: true, why: "" };
}

const fail = (reason: string): ApplyOutcome => ({ ok: false, reason });

export function isActive(state: Pick<TraumaState, "tier" | "paidUntil">, now: number): boolean {
  return state.tier !== "none" && state.paidUntil !== null && state.paidUntil > now;
}

export function applyTrauma(
  draft: Draft<TraumaState>,
  command: TraumaCommand,
  ctx: SystemContext,
): ApplyOutcome {
  if (command.action === "join") {
    const tier = command.tier ?? "silver";
    const price = TRAUMA_PRICES[tier];
    if (draft.tier === tier && isActive(draft, ctx.now))
      return fail(`已经是${TRAUMA_TIER_LABELS[tier]}，这一期还没到期`);
    const eddies = ctx.read<EconomyState>("economy").eddies;
    if (eddies < price)
      return fail(`${TRAUMA_TIER_LABELS[tier]}一期 ${price} 欧元，身上只有 ${eddies}，付不起`);
    draft.tier = tier;
    draft.paidUntil = ctx.now + TRAUMA_PERIOD;
    draft.lapsedAt = null;
    return {
      ok: true,
      notes: [`创伤小组${TRAUMA_TIER_LABELS[tier]}：管 30 天（${command.reason}）`],
      emit: [{ type: "money", delta: -price, reason: `创伤小组${TRAUMA_TIER_LABELS[tier]}一期` }],
    };
  }
  if (command.action === "cancel") {
    if (draft.tier === "none") return fail("没有创伤小组会籍");
    const label = TRAUMA_TIER_LABELS[draft.tier];
    draft.tier = "none";
    draft.paidUntil = null;
    return { ok: true, notes: [`退掉了创伤小组${label}（${command.reason}），已付的不退`] };
  }
  const location = ctx.read<WorldClockState>("world").location;
  const district =
    location === null ? null : (locationCatalog(ctx.data).get(location)?.district ?? null);
  const check = dispatchCheck({
    tier: draft.tier,
    active: isActive(draft, ctx.now),
    condition: ctx.read<HealthState>("health").condition,
    inCombat: ctx.read<CombatState>("combat").active !== null,
    district,
    stars: ctx.read<HeatState>("heat").stars,
  });
  if (!check.ok) return fail(`创伤小组不会来：${check.why}`);
  draft.rescues += 1;
  return {
    ok: true,
    notes: [`创伤小组赶到，把你救了回来（${command.reason}）`],
    emit: [{ type: "health.revive" }],
  };
}

/** 到期不续：会籍失效，记下过期时间 */
export function tickTrauma(draft: Draft<TraumaState>, span: TimeSpan): void {
  if (draft.tier !== "none" && draft.paidUntil !== null && draft.paidUntil <= span.to) {
    draft.lapsedAt = draft.paidUntil;
    draft.tier = "none";
    draft.paidUntil = null;
  }
}
