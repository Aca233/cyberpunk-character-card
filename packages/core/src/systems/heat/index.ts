import { defineSystem } from "../../kernel/system";
import { locationCatalog, type WorldClockState } from "../world";
import { applyEvent, applyHeat, type Place, tickHeat } from "./apply";
import { eventRules, heatRules } from "./prompt";
import {
  type EventCommand,
  EventCommandSchema,
  type HeatCommand,
  HeatCommandSchema,
  type HeatState,
  HeatStateSchema,
} from "./schema";

function placeOf(location: string | null, data: Readonly<Record<string, unknown>>): Place {
  const def = location === null ? undefined : locationCatalog(data).get(location);
  return { district: def?.district ?? null, zone: def?.zone ?? "street" };
}

/** 警方热度：事件按地点和城区警力推导，随时间、换城区和贿赂下降；贿赂的钱交给欧元系统扣 */
export const heat = defineSystem<HeatState, EventCommand | HeatCommand>({
  id: "heat",
  dependsOn: ["world", "economy"],
  state: HeatStateSchema,
  initial: () => ({
    stars: 0,
    lastSeenAt: null,
    decayedAt: null,
    district: null,
    districtDay: null,
    recent: [],
  }),
  commands: { event: EventCommandSchema, heat: HeatCommandSchema },
  apply(draft, command, ctx) {
    if (command.type === "heat") return applyHeat(draft, command, ctx.now);
    const place = placeOf(ctx.read<WorldClockState>("world").location, ctx.data);
    return applyEvent(draft, command, place, ctx.now);
  },
  tick(draft, span, ctx) {
    const place = placeOf(ctx.read<WorldClockState>("world").location, ctx.data);
    tickHeat(draft, span, place.district);
  },
  rules: [eventRules, heatRules],
});

export * from "./apply";
export * from "./prompt";
export * from "./schema";
