import { defineSystem } from "../../kernel/system";
import { ALERT_HEAT_LEVEL, type StealthState } from "../stealth";
import { locationCatalog, type WorldClockState } from "../world";
import { applyBounty, applyEvent, applyHeat, applyRelief, tickHeat } from "./apply";
import { eventRules, heatRules } from "./prompt";
import {
  type BountyCommand,
  BountyCommandSchema,
  type EventCommand,
  EventCommandSchema,
  HEAT_MAX,
  type HeatCommand,
  HeatCommandSchema,
  type HeatRelief,
  HeatReliefSchema,
  type HeatState,
  HeatStateSchema,
} from "./schema";

function districtOf(
  location: string | null,
  data: Readonly<Record<string, unknown>>,
): string | null {
  if (location === null) return null;
  return locationCatalog(data).get(location)?.district ?? null;
}

/** 警方热度：事件按目击和动静推导，随时间、换城区和贿赂下降；贿赂的钱交给欧元系统扣 */
export const heat = defineSystem<HeatState, EventCommand | HeatCommand | BountyCommand, HeatRelief>(
  {
    id: "heat",
    dependsOn: ["world", "economy", "stealth"],
    state: HeatStateSchema,
    initial: () => ({
      stars: 0,
      lastSeenAt: null,
      decayedAt: null,
      district: null,
      districtDay: null,
      hideoutDay: null,
      recent: [],
      bounties: [],
    }),
    commands: { event: EventCommandSchema, heat: HeatCommandSchema, bounty: BountyCommandSchema },
    internal: { "heat.relief": HeatReliefSchema },
    apply(draft, command, ctx) {
      if (command.type === "heat") return applyHeat(draft, command, ctx.now);
      if (command.type === "bounty") return applyBounty(draft, command, ctx.now);
      if (command.type === "heat.relief") return applyRelief(draft, command);
      const district = districtOf(ctx.read<WorldClockState>("world").location, ctx.data);
      return applyEvent(draft, command, district, ctx.now);
    },
    tick(draft, span, ctx) {
      // heat 不能读安全屋（safehouse→travel→heat 会成环），回合流程把“这一轮躲在自己的安全屋里”放进事实
      tickHeat(
        draft,
        span,
        districtOf(ctx.read<WorldClockState>("world").location, ctx.data),
        ctx.facts.hideout === true,
      );
    },
    on: {
      // 潜入收尾：刚结束的场景警戒到过搜索档，有人看清了你，热度加一星
      "scene.end": (draft, ctx) => {
        const alert = ctx.read<StealthState>("stealth");
        const ended = ctx.read<WorldClockState>("world").scene - 1;
        if (alert.scene === ended && alert.peak >= ALERT_HEAT_LEVEL) {
          draft.stars = Math.min(HEAT_MAX, draft.stars + 1);
          draft.lastSeenAt = ctx.now;
        }
      },
    },
    rules: [eventRules, heatRules],
  },
);

export * from "./apply";
export * from "./prompt";
export * from "./schema";
