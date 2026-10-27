import type { ViewContext } from "../../kernel/system";
import { formatGameTime, locationCatalog, WorldClockStateSchema } from "../world";
import { dispatchCheck, isActive } from "./apply";
import { TRAUMA_PRICES, TRAUMA_TIER_LABELS, TraumaStateSchema } from "./schema";

/** 创伤小组会籍，和现在倒下的话叫不叫得来 */
export function traumaView({ world, data }: ViewContext) {
  const { location } = WorldClockStateSchema.parse(world.slices.world);
  const now = world.time;
  const state = TraumaStateSchema.parse(world.slices.trauma ?? {});
  const slices = world.slices as Record<string, { readonly [k: string]: unknown } | undefined>;
  const active = isActive(state, now);
  const dispatch = dispatchCheck({
    tier: state.tier,
    active,
    condition: (slices.health?.condition as "up" | "down" | "dying" | "dead" | undefined) ?? "up",
    inCombat: (slices.combat?.active ?? null) !== null,
    district: location === null ? null : (locationCatalog(data).get(location)?.district ?? null),
    stars: Number(slices.heat?.stars ?? 0),
  });
  return {
    tier: state.tier,
    tierLabel: TRAUMA_TIER_LABELS[state.tier],
    active,
    until: state.paidUntil === null ? null : formatGameTime(state.paidUntil),
    /** 过期一周内提醒，再久就不提了 */
    lapsed:
      state.lapsedAt === null || now - state.lapsedAt > 7 * 1440
        ? null
        : formatGameTime(state.lapsedAt),
    rescues: state.rescues,
    prices: TRAUMA_PRICES,
    /** 现在倒下的话来不来；没倒下时按倒下算 */
    dispatch,
  };
}
