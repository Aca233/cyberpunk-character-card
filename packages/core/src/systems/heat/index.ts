import { defineSystem } from "../../kernel/system";
import { type CombatState, EVIDENCE_STARS } from "../combat";
import { ALERT_HEAT_LEVEL, type StealthState } from "../stealth";
import { locationCatalog, type WorldClockState } from "../world";
import {
  applyBounty,
  applyEvent,
  applyHeat,
  applyRelief,
  noticeRise,
  shownStars,
  tickHeat,
} from "./apply";
import { heatEvents } from "./events";
import { heatFeed } from "./feed";
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
import { heatStatus } from "./status";
import { heatThreats } from "./threats";
import { heatView } from "./view";

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
    dependsOn: ["world", "economy", "stealth", "combat"],
    state: HeatStateSchema,
    initial: () => ({
      stars: 0,
      lastSeenAt: null,
      decayedAt: null,
      district: null,
      districtDay: null,
      hideoutDay: null,
      recent: [],
      nextNotice: 1,
      notices: [],
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
      const district = districtOf(ctx.read<WorldClockState>("world").location, ctx.data);
      // 证据按实际入库时间结算；中间只衰减，安全屋和换区仍按完整跨度结算一次。
      let from = span.from;
      // combat 先结算录像；只处理本次时间跨度内入库的证据，后续推进不重复涨星
      const evidence = ctx
        .read<CombatState>("combat")
        .footage.filter(
          (f) =>
            f.fired === "evidence" &&
            f.firedAt !== null &&
            f.firedAt > span.from &&
            f.firedAt <= span.to,
        );
      const arrivals = new Map<number, number>();
      for (const f of evidence) {
        if (f.firedAt === null) continue;
        arrivals.set(f.firedAt, (arrivals.get(f.firedAt) ?? 0) + 1);
      }
      for (const [at, count] of [...arrivals].sort(([a], [b]) => a - b)) {
        tickHeat(draft, { from, to: at }, null);
        from = at;
        const before = shownStars(draft.stars);
        draft.stars = Math.min(HEAT_MAX, draft.stars + count * EVIDENCE_STARS);
        draft.lastSeenAt = at;
        draft.decayedAt = at;
        noticeRise(draft, before, shownStars(draft.stars), at);
      }
      tickHeat(draft, span, district, ctx.facts.hideout === true);
    },
    on: {
      // 潜入收尾：刚结束的场景警戒到过搜索档，有人看清了你，热度加一星
      "scene.end": (draft, ctx) => {
        const alert = ctx.read<StealthState>("stealth");
        const ended = ctx.read<WorldClockState>("world").scene - 1;
        if (alert.scene === ended && alert.peak >= ALERT_HEAT_LEVEL) {
          const before = shownStars(draft.stars);
          draft.stars = Math.min(HEAT_MAX, draft.stars + 1);
          draft.lastSeenAt = ctx.now;
          noticeRise(draft, before, shownStars(draft.stars), ctx.now);
        }
      },
    },
    rules: [eventRules, heatRules],
    threats: heatThreats,
    events: heatEvents,
    feed: heatFeed,
    view: { key: "heat", project: heatView },
    status: heatStatus,
  },
);

export * from "./apply";
export * from "./events";
export * from "./feed";
export * from "./prompt";
export * from "./schema";
export * from "./status";
export * from "./threats";
export * from "./view";
