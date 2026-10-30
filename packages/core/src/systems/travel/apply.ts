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
  METERS_PER_PERCENT,
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
import { activeVehicle, vehicleCatalog, vehicleFactor } from "./vehicles";

/**
 * 耗时 = 固定 + 每单位距离的分钟数；1 单位 100 米。两头都在路线表里时按路面距离（§七 简单版做法，步行和开车共用一张路面图，用户定的），
 * 否则按底图百分比坐标的直线距离，1 个百分点约 78 米（本作改编，待校准）。
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
  /** 路程是估的（§七：有一头离路面太远、坐标待核对，或不在路线表里只能按直线）；准的时候不带这个字段 */
  readonly rough?: true;
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
      world.slices.travel ?? { trips: [], encounterScene: null, encounter: null, vehicles: [] },
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

/**
 * 路面距离表（places-plan §七 简单版做法，用户定的“车和人先合在一起”）：content 包离线算好的锚点两两路面米数，
 * 放在 data.routes；meters 是上三角摊平，下标 i*n - i*(i+1)/2 + (j-i-1)
 */
interface RouteTableData {
  readonly anchors: readonly { readonly id: string; readonly rough: boolean }[];
  readonly meters: readonly number[];
}

const routeIndexes = new WeakMap<object, ReadonlyMap<string, number>>();

function routeTableOf(data: Readonly<Record<string, unknown>>): RouteTableData | undefined {
  const raw = data.routes as Partial<RouteTableData> | undefined;
  return raw && Array.isArray(raw.anchors) && Array.isArray(raw.meters)
    ? (raw as RouteTableData)
    : undefined;
}

function routeIndexOf(table: RouteTableData): ReadonlyMap<string, number> {
  const cached = routeIndexes.get(table);
  if (cached) return cached;
  const index = new Map(table.anchors.map((a, i) => [a.id, i] as const));
  routeIndexes.set(table, index);
  return index;
}

/**
 * 这个地点标了“大概”：路线表里标的（离路面超过 250 米或坐标本身待核对，§七），
 * 或者是地点簿里代码推算坐标的新地点（places-plan §四"大概位置"）
 */
export function roughPlace(data: Readonly<Record<string, unknown>>, id: string): boolean {
  if (locationCatalog(data).get(id)?.rough === true) return true;
  const table = routeTableOf(data);
  if (!table) return false;
  const i = routeIndexOf(table).get(id);
  return i !== undefined && table.anchors[i]?.rough === true;
}

/** 路线表锚点的坐标：从地点表（含地点簿）和周边锚点（poi:、ft:）里找；按 data 缓存 */
const anchorSpots = new WeakMap<object, readonly { id: string; x: number; y: number }[]>();

function anchorSpotsOf(
  data: Readonly<Record<string, unknown>>,
  table: RouteTableData,
): readonly { id: string; x: number; y: number }[] {
  const cached = anchorSpots.get(data);
  if (cached) return cached;
  const spots = new Map<string, { x: number; y: number }>();
  if (Array.isArray(data.radar)) {
    for (const a of data.radar as { id: string; x: number; y: number }[]) {
      spots.set(a.id, { x: a.x, y: a.y });
    }
  }
  for (const p of locationCatalog(data).values()) {
    const s = spot(p);
    if (s) spots.set(p.id, s);
  }
  const out = table.anchors.flatMap((a) => {
    const s = spots.get(a.id);
    return s ? [{ id: a.id, ...s }] : [];
  });
  anchorSpots.set(data, out);
  return out;
}

/** 离这个点最近的路线表锚点和直线米数；表里的锚点都没有坐标时是 undefined */
function nearestAnchor(
  data: Readonly<Record<string, unknown>>,
  table: RouteTableData,
  p: { x: number; y: number },
): { readonly id: string; readonly meters: number } | undefined {
  let best: { id: string; meters: number } | undefined;
  for (const a of anchorSpotsOf(data, table)) {
    const meters = Math.hypot(a.x - p.x, a.y - p.y) * METERS_PER_PERCENT;
    if (!best || meters < best.meters) best = { id: a.id, meters };
  }
  return best;
}

/** 两地的路面距离（米）；表里没有其中一头时是 undefined，调用方退回直线 */
export function roadMetersBetween(
  data: Readonly<Record<string, unknown>>,
  from: string,
  to: string,
): number | undefined {
  const table = routeTableOf(data);
  if (!table) return undefined;
  const index = routeIndexOf(table);
  const a = index.get(from);
  const b = index.get(to);
  if (a === undefined || b === undefined) return undefined;
  if (a === b) return 0;
  const [i, j] = a < b ? [a, b] : [b, a];
  const n = table.anchors.length;
  return table.meters[i * n - (i * (i + 1)) / 2 + (j - i - 1)];
}

/**
 * 出行用的距离（单位约 100 米）：两头都在路线表里按路面距离，否则按地图直线（§七 简单版做法）；
 * rough 是有一头标了“大概”，或者只能按直线算
 */
export function tripDistance(
  data: Readonly<Record<string, unknown>>,
  a: LocationDef | undefined,
  b: LocationDef | undefined,
): { readonly d: number; readonly rough: boolean } | undefined {
  const straight = distanceBetween(a, b);
  if (!a || !b || straight === undefined) return undefined;
  const table = routeTableOf(data);
  // 没有路线表（旧数据、测试）时照旧按直线，不标“大概”
  if (!table) return { d: straight, rough: false };
  const road = roadMetersBetween(data, a.id, b.id);
  if (road !== undefined) {
    return { d: road / 100, rough: roughPlace(data, a.id) || roughPlace(data, b.id) };
  }
  // §七：表里没有的一头（地点簿的新地点等）先直线走到离它最近的锚点，再按路面；标“大概”
  const index = routeIndexOf(table);
  const leg = (p: LocationDef) => {
    if (index.has(p.id)) return { id: p.id, meters: 0 };
    const s = spot(p);
    return s ? nearestAnchor(data, table, s) : undefined;
  };
  const la = leg(a);
  const lb = leg(b);
  const mid = la && lb ? roadMetersBetween(data, la.id, lb.id) : undefined;
  if (!la || !lb || mid === undefined) return { d: straight, rough: true };
  return { d: (la.meters + mid + lb.meters) / 100, rough: true };
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
  const trip = tripDistance(data, here, there);
  const d = trip?.d;
  const period = periodOf(w.now);
  const cars = vehicleCatalog(data);
  return MODES.map((mode) => {
    const speed = TRAVEL_SPEEDS[mode];
    // 开车：按正在开的那辆的速度档和车况折算
    const car =
      mode === "car" || mode === "stolen"
        ? activeVehicle(w.travel.vehicles, mode === "stolen")
        : undefined;
    const carDef = car ? cars.get(car.model) : undefined;
    const factor = car ? vehicleFactor(car, carDef) : 1;
    const minutes =
      d === undefined ? 0 : Math.max(1, Math.round(speed.fixed + d * speed.perUnit * factor));
    const cost =
      mode === "taxi" && d !== undefined ? Math.ceil((TAXI_BASE + d * TAXI_PER_UNIT) / 5) * 5 : 0;
    const risk = riskOf(mode, period, w.heat);
    const base = {
      mode,
      label: carDef ? `${TRAVEL_MODE_LABELS[mode]}（${carDef.name}）` : TRAVEL_MODE_LABELS[mode],
      minutes,
      cost,
      risk,
      riskLabel: RISK_LABELS[risk],
      ...(trip?.rough ? { rough: true as const } : {}),
    };
    const blocked = blockOf(w, mode, here, there, d, cost, car !== undefined);
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
  hasCar: boolean,
): string | undefined {
  if (!there) return "这个地点不在地点表里";
  if (w.inCombat) return "战斗中走不开";
  if (here && here.id === there.id) return "已经在这里了";
  if (d === undefined)
    return spot(there) ? "现在的位置不在地图上，用自由输入写怎么去" : `${there.name}还没上地图`;
  if (mode === "metro" && !(here?.metro && there.metro)) return "两头不都有轻轨站";
  if (mode === "car" && !hasCar)
    return w.travel.vehicles.some((v) => !v.stolen) ? "自己的车都报废了" : "还没有自己的车";
  if (mode === "stolen" && !hasCar) return "手上没有偷来的车：先在正文里偷一辆";
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
  // §七：路程是估的就照实说“大概”，正文别写成精确的路线
  const about = route.rough ? "大概" : "";
  const lines = [
    `【出行】玩家在路线面板确认：${route.label}从${from.name}去${to.name}（${to.district}），路上${about} ${route.minutes} 分钟，${formatGameTime(trip.arriveAt)}（${PERIOD_LABELS[periodOf(trip.arriveAt)]}）到，${money}，风险${route.riskLabel}。时间和地点由代码记，world 里不要再写 location，time 只能写到达以后。`,
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
