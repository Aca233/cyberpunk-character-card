import type { Draft } from "immer";
import type { Rng } from "../../kernel/ports";
import type { ApplyOutcome, SystemContext } from "../../kernel/system";
import { CharacterStateSchema } from "../character";
import { CombatStateSchema } from "../combat";
import { EconomyStateSchema } from "../economy";
import { HeatStateSchema } from "../heat";
import {
  formatGameTime,
  type LocationDef,
  locationCatalog,
  PERIOD_LABELS,
  type Period,
  periodOf,
  WorldClockStateSchema,
} from "../world";
import {
  EncounterCatalogSchema,
  type EncounterDef,
  RISK_LABELS,
  type Risk,
  TRAVEL_MODE_LABELS,
  TRIPS_KEPT,
  type TravelCommand,
  TravelFactSchema,
  type TravelMode,
  type TravelRequest,
  type TravelState,
  TravelStateSchema,
} from "./schema";

/**
 * 耗时 = 固定 + 每单位距离的分钟数；距离是底图百分比坐标的直线距离，1 单位约 100 米（本作改编，待校准）。
 * 步行约每小时 5 公里；轻轨的固定时间是走到站、等车；出租车的固定时间是等车来。
 */
export const TRAVEL_SPEEDS: Readonly<
  Record<TravelMode, { readonly fixed: number; readonly perUnit: number }>
> = {
  walk: { fixed: 2, perUnit: 1.2 },
  metro: { fixed: 12, perUnit: 0.15 },
  taxi: { fixed: 6, perUnit: 0.18 },
  car: { fixed: 2, perUnit: 0.15 },
  stolen: { fixed: 4, perUnit: 0.15 },
};
/** Delamain 起步价和每单位距离的价钱（本作改编）；NCART 不要钱（原作依据 2.1） */
export const TAXI_BASE = 20;
export const TAXI_PER_UNIT = 1.5;
/** 偶遇的基础几率（百分比），按路线风险；每颗通缉星再加，深夜再加 */
export const ENCOUNTER_BASE: Readonly<Record<Risk, number>> = { low: 8, medium: 18, high: 30 };
export const ENCOUNTER_PER_STAR = 4;
export const ENCOUNTER_NIGHT = 6;
export const ENCOUNTER_MAX = 60;

const MODES: readonly TravelMode[] = ["walk", "metro", "taxi", "car", "stolen"];

export interface RouteOption {
  readonly mode: TravelMode;
  readonly label: string;
  readonly minutes: number;
  readonly cost: number;
  readonly risk: Risk;
  readonly riskLabel: string;
  /** 走不了时写原因 */
  readonly blocked?: string;
}

/** 算路线要看的状态 */
export interface TripWorld {
  readonly now: number;
  readonly scene: number;
  readonly location: string | null;
  readonly heat: number;
  readonly cred: number;
  readonly eddies: number;
  readonly inCombat: boolean;
  readonly travel: TravelState;
}

export function tripWorldOf(world: {
  readonly time: number;
  readonly slices: Readonly<Record<string, unknown>>;
}): TripWorld {
  const clock = WorldClockStateSchema.parse(world.slices.world);
  return {
    now: world.time,
    scene: clock.scene,
    location: clock.location,
    heat: HeatStateSchema.parse(world.slices.heat).stars,
    cred: CharacterStateSchema.parse(world.slices.character).streetCred,
    eddies: EconomyStateSchema.parse(world.slices.economy).eddies,
    inCombat: CombatStateSchema.parse(world.slices.combat).active !== null,
    travel: TravelStateSchema.parse(
      world.slices.travel ?? { trips: [], encounterScene: null, encounter: null },
    ),
  };
}

function spot(place: LocationDef | undefined): { x: number; y: number } | undefined {
  return place?.x !== undefined && place.y !== undefined ? { x: place.x, y: place.y } : undefined;
}

/** 两地之间的距离（单位约 100 米）；有一边不在地图上时是 undefined */
export function distanceBetween(a: LocationDef | undefined, b: LocationDef | undefined) {
  const p = spot(a);
  const q = spot(b);
  return p && q ? Math.hypot(p.x - q.x, p.y - q.y) : undefined;
}

function riskOf(mode: TravelMode, period: Period, heat: number): Risk {
  if (mode === "stolen") return "high";
  if (mode === "walk") {
    if (heat >= 2) return "high";
    return period === "night" || period === "dusk" ? "medium" : "low";
  }
  if (mode === "taxi") return "low";
  return heat >= 3 ? "medium" : "low";
}

/** 从现在的位置到 to 的全部路线；面板显示和结算用同一个函数，耗时和花费一定一致 */
export function routeOptions(
  w: TripWorld,
  data: Readonly<Record<string, unknown>>,
  to: string,
): RouteOption[] {
  const places = locationCatalog(data);
  const here = w.location === null ? undefined : places.get(w.location);
  const there = places.get(to);
  const d = distanceBetween(here, there);
  const period = periodOf(w.now);
  return MODES.map((mode) => {
    const speed = TRAVEL_SPEEDS[mode];
    const minutes = d === undefined ? 0 : Math.max(1, Math.round(speed.fixed + d * speed.perUnit));
    const cost =
      mode === "taxi" && d !== undefined ? Math.ceil((TAXI_BASE + d * TAXI_PER_UNIT) / 5) * 5 : 0;
    const risk = riskOf(mode, period, w.heat);
    const base = {
      mode,
      label: TRAVEL_MODE_LABELS[mode],
      minutes,
      cost,
      risk,
      riskLabel: RISK_LABELS[risk],
    };
    const blocked = blockOf(w, mode, here, there, d, cost);
    return blocked ? { ...base, blocked } : base;
  });
}

function blockOf(
  w: TripWorld,
  mode: TravelMode,
  here: LocationDef | undefined,
  there: LocationDef | undefined,
  d: number | undefined,
  cost: number,
): string | undefined {
  if (!there) return "这个地点不在地点表里";
  if (w.inCombat) return "战斗中走不开";
  if (here && here.id === there.id) return "已经在这里了";
  if (d === undefined)
    return spot(there) ? "现在的位置不在地图上，用自由输入写怎么去" : `${there.name}还没上地图`;
  if (mode === "metro" && !(here?.metro && there.metro)) return "两头不都有轻轨站";
  if (mode === "car") return "还没有自己的车";
  if (mode === "stolen") return "附近没有能偷的车";
  if (cost > w.eddies) return `钱不够：要 ${cost}，只有 ${w.eddies}`;
  return undefined;
}

/** 写正文前定下的一次出行 */
export interface PlannedTrip {
  readonly from: LocationDef;
  readonly to: LocationDef;
  readonly route: RouteOption;
  readonly arriveAt: number;
  readonly encounter: EncounterDef | null;
}

export type TripPlan =
  | { readonly ok: true; readonly trip: PlannedTrip }
  | { readonly ok: false; readonly reason: string };

/** 偶遇怎么定：掷（rng + 频率倍数），或照写正文前已经定下的（fixed） */
export type EncounterRoll =
  | { readonly rng: Rng; readonly factor: number }
  | { readonly fixed: string | null }
  | undefined;

export function encounterChance(route: RouteOption, w: TripWorld, factor: number): number {
  const night = periodOf(w.now) === "night" ? ENCOUNTER_NIGHT : 0;
  const base = ENCOUNTER_BASE[route.risk] + Math.floor(w.heat) * ENCOUNTER_PER_STAR + night;
  return Math.min(ENCOUNTER_MAX, Math.round(base * factor));
}

/** 能抽到的偶遇：按目的地城区、到达时段、通缉星、声望、出行方式筛 */
export function eligibleEncounters(
  defs: readonly EncounterDef[],
  district: string,
  period: Period,
  w: TripWorld,
  mode: TravelMode,
): EncounterDef[] {
  return defs.filter(
    (e) =>
      (!e.districts || e.districts.includes(district)) &&
      (!e.periods || e.periods.includes(period)) &&
      (e.minHeat === undefined || w.heat >= e.minHeat) &&
      (e.minCred === undefined || w.cred >= e.minCred) &&
      (!e.modes || e.modes.includes(mode)),
  );
}

export function planTrip(
  w: TripWorld,
  data: Readonly<Record<string, unknown>>,
  request: TravelRequest,
  roll?: EncounterRoll,
): TripPlan {
  const route = routeOptions(w, data, request.to).find((r) => r.mode === request.mode);
  if (!route) return { ok: false, reason: `没有这种出行方式：${request.mode}` };
  if (route.blocked) return { ok: false, reason: route.blocked };
  const places = locationCatalog(data);
  const from = places.get(w.location ?? "") as LocationDef;
  const to = places.get(request.to) as LocationDef;
  const arriveAt = w.now + route.minutes;
  const defs = EncounterCatalogSchema.parse(data.encounters ?? []);
  let encounter: EncounterDef | null = null;
  if (roll && "fixed" in roll) {
    encounter = roll.fixed === null ? null : (defs.find((e) => e.id === roll.fixed) ?? null);
  } else if (roll && from.district !== to.district && w.travel.encounterScene !== w.scene) {
    // 换城区才有偶遇，一个场景最多一次
    const chance = encounterChance(route, w, roll.factor);
    if (chance > 0 && roll.rng.roll(100) <= chance) {
      const pool = eligibleEncounters(defs, to.district, periodOf(arriveAt), w, route.mode);
      const total = pool.reduce((s, e) => s + e.weight, 0);
      if (total > 0) {
        let n = roll.rng.roll(total);
        for (const e of pool) {
          n -= e.weight;
          if (n <= 0) {
            encounter = e;
            break;
          }
        }
      }
    }
  }
  return { ok: true, trip: { from, to, route, arriveAt, encounter } };
}

/** 交给写正文的一步：代码已经定下的出行 */
export function tripText(trip: PlannedTrip): string {
  const { route, from, to } = trip;
  const money = route.cost > 0 ? `路费 ${route.cost} 欧元由代码扣` : "不花钱";
  const lines = [
    `【出行】玩家在路线面板确认：${route.label}从${from.name}去${to.name}（${to.district}），路上 ${route.minutes} 分钟，${formatGameTime(trip.arriveAt)}（${PERIOD_LABELS[periodOf(trip.arriveAt)]}）到，${money}，风险${route.riskLabel}。时间和地点由代码记，world 里不要再写 location，time 只能写到达以后。`,
  ];
  if (trip.encounter) {
    lines.push(
      `【路上偶遇】代码定的，这一场要写出来：${trip.encounter.label}——${trip.encounter.note}。玩家可以不理，不理就照素材让事情在屏幕外发展；这一场不要再加别的偶遇。`,
    );
  }
  return lines.join("\n");
}

export function tripFact(trip: PlannedTrip) {
  return { to: trip.to.id, mode: trip.route.mode, encounter: trip.encounter?.id ?? null };
}

const fail = (reason: string): ApplyOutcome => ({ ok: false, reason });

export function applyTravel(
  draft: Draft<TravelState>,
  command: TravelCommand,
  ctx: SystemContext,
): ApplyOutcome {
  const clock = ctx.read<{ scene: number; location: string | null }>("world");
  const w: TripWorld = {
    now: ctx.now,
    scene: clock.scene,
    location: clock.location,
    heat: ctx.read<{ stars: number }>("heat").stars,
    cred: ctx.read<{ streetCred: number }>("character").streetCred,
    eddies: ctx.read<{ eddies: number }>("economy").eddies,
    inCombat: ctx.read<{ active: unknown }>("combat").active !== null,
    travel: draft as TravelState,
  };
  const fact = TravelFactSchema.safeParse(ctx.facts.travel);
  const fixed =
    fact.success && fact.data.to === command.to && fact.data.mode === command.mode
      ? { fixed: fact.data.encounter }
      : { rng: ctx.rng, factor: 1 };
  const planned = planTrip(w, ctx.data, command, fixed);
  if (!planned.ok) return fail(planned.reason);
  const { from, to, route, arriveAt, encounter } = planned.trip;
  draft.trips.push({
    from: from.id,
    to: to.id,
    mode: route.mode,
    minutes: route.minutes,
    cost: route.cost,
    at: ctx.now,
    encounter: encounter?.id ?? null,
  });
  if (draft.trips.length > TRIPS_KEPT) draft.trips.splice(0, draft.trips.length - TRIPS_KEPT);
  const notes = [`${route.label}从${from.name}到${to.name}：${route.minutes} 分钟`];
  if (encounter) {
    draft.encounterScene = clock.scene;
    draft.encounter = {
      id: encounter.id,
      label: encounter.label,
      note: encounter.note,
      district: to.district,
      at: arriveAt,
    };
    notes.push(`路上偶遇：${encounter.label}`);
  }
  return {
    ok: true,
    notes,
    emit: [
      { type: "world", activity: "travel", time: arriveAt, location: to.id },
      ...(route.cost > 0
        ? [{ type: "money", delta: -route.cost, reason: `${route.label}去${to.name}` }]
        : []),
    ],
  };
}

/** 场景结束：这一场的偶遇翻篇 */
export function clearEncounter(draft: Draft<TravelState>): void {
  draft.encounter = null;
}
