import type { ViewContext } from "../../kernel/system";
import { formatGameTime, locationCatalog, WorldClockStateSchema, withSavedPlaces } from "../world";
import {
  dispatchCheck,
  isActive,
  membershipBlock,
  quoteTraumaMembership,
  type TraumaPurchase,
} from "./apply";
import { TRAUMA_PERIOD, TRAUMA_PRICES, TRAUMA_TIER_LABELS, TraumaStateSchema } from "./schema";

/** 同一套内核报价与资格分别投影保障待命、实际救援和会员办理。 */
export function traumaView({ world, data }: ViewContext) {
  const clock = WorldClockStateSchema.parse(world.slices.world);
  const places = locationCatalog(withSavedPlaces(data, world));
  const now = world.time;
  const state = TraumaStateSchema.parse(world.slices.trauma);
  const slices = world.slices as Record<string, { readonly [k: string]: unknown } | undefined>;
  const active = isActive(state, now);
  const condition =
    (slices.health?.condition as "up" | "down" | "dying" | "dead" | undefined) ?? "up";
  const inCombat = (slices.combat?.active ?? null) !== null;
  const eddies = Number(slices.economy?.eddies ?? 0);
  const input = {
    tier: state.tier,
    active,
    condition,
    inCombat,
    district: clock.location === null ? null : (places.get(clock.location)?.district ?? null),
    stars: Number(slices.heat?.stars ?? 0),
  };
  const rescue = dispatchCheck(input);
  const coverage = dispatchCheck({ ...input, condition: condition === "up" ? "down" : condition });
  const blocked = membershipBlock(condition, inCombat);
  const offers = (["silver", "platinum"] as const).map((tier) => {
    const action: TraumaPurchase = !active
      ? "join"
      : state.tier === tier
        ? "renew"
        : state.tier === "silver"
          ? "upgrade"
          : "join";
    const quote = quoteTraumaMembership(state, action, tier, now);
    const price = quote.ok ? quote.price : TRAUMA_PRICES[tier];
    const reason = !quote.ok
      ? quote.reason
      : (blocked ?? (eddies < price ? `余额不足，需要 ${price} 欧元，身上只有 ${eddies}` : null));
    return {
      tier,
      tierLabel: TRAUMA_TIER_LABELS[tier],
      action,
      label: quote.ok ? quote.label : `开通${TRAUMA_TIER_LABELS[tier]} 30 天`,
      quoteValid: quote.ok,
      price,
      until: formatGameTime(quote.ok ? quote.paidUntil : now + TRAUMA_PERIOD),
      available: reason === null,
      reason,
    };
  });
  const cancelReason = !active ? "没有有效会籍" : blocked;
  return {
    tier: state.tier,
    tierLabel: TRAUMA_TIER_LABELS[state.tier],
    active,
    until: active && state.paidUntil !== null ? formatGameTime(state.paidUntil) : null,
    remainingMinutes: active && state.paidUntil !== null ? state.paidUntil - now : 0,
    lapsed:
      state.lapsedAt === null || now - state.lapsedAt > 7 * 1440
        ? null
        : formatGameTime(state.lapsedAt),
    rescues: state.rescues,
    lastRescue:
      state.lastRescue === null
        ? null
        : {
            at: formatGameTime(state.lastRescue.at),
            location:
              state.lastRescue.location === null
                ? null
                : (places.get(state.lastRescue.location)?.name ?? state.lastRescue.location),
            tierLabel: TRAUMA_TIER_LABELS[state.lastRescue.tier],
          },
    prices: TRAUMA_PRICES,
    coverage,
    rescue,
    offers,
    canCancel: cancelReason === null,
    cancelReason,
  };
}
