import type { Draft } from "immer";
import type { Rng } from "../../kernel/ports";
import type { ApplyOutcome, SystemContext } from "../../kernel/system";
import { CharacterStateSchema, hasDeedAtLeast, type KnownDeed } from "../character";
import { CombatStateSchema } from "../combat";
import { EconomyStateSchema } from "../economy";
import {
  attitudeLabel,
  currentAttitude,
  currentTurf,
  type FactionsState,
  FactionsStateSchema,
  factionCatalog,
} from "../factions";
import { HeatStateSchema } from "../heat";
import { type NcpdState, NcpdStateSchema } from "../ncpd";
import {
  formatDuration,
  formatGameTime,
  type LocationDef,
  locationCatalog,
  locationForTravel,
  METERS_PER_PERCENT,
  PERIOD_LABELS,
  type Period,
  periodOf,
  placeKey,
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
import { drivableVehiclesAt, resolveVehicleAt, vehicleCatalog, vehicleFactor } from "./vehicles";

/**
 * 耗时 = 固定 + 每单位距离的分钟数；1 单位 = 原作地图坐标 100 米。
 * 说明：2077 游戏实景地图为都市微缩比例（跨全城仅约 4.5 公里），直接按 1:1 物理速度会导致跨 3 个城区开车只用 6 分钟。
 * 因此在保留路线表真实拓扑比例的前提下，将车辆/轨道/步行的单位时间按大都市通勤尺度校准：
 * - 步行：每 100m 约 1.35 分钟（含红绿灯、过街天桥与立体街区上下梯道）
 * - 开车/赃车：每 100m 约 0.42 分钟（城区红绿灯、高架匝道与微缩尺度折算；跨全城约 20–30 分钟）
 * - Delamain：等车 5 分钟 + 每 100m 约 0.45 分钟（合规范行车、不逆行）
 * - NCART 轻轨：进站候车 8 分钟 + 每 100m 约 0.22 分钟（不受早晚高峰堵车影响，中远距跨区显著快于步行）
 */
export const TRAVEL_SPEEDS: Readonly<
  Record<TravelMode, { readonly fixed: number; readonly perUnit: number }>
> = {
  walk: { fixed: 2, perUnit: 1.35 },
  metro: { fixed: 8, perUnit: 0.22 },
  taxi: { fixed: 5, perUnit: 0.45 },
  car: { fixed: 3, perUnit: 0.42 },
  stolen: { fixed: 4, perUnit: 0.4 },
};
/** 跨狗镇幽冥犬关口安检额外耗时（分钟） */
export const DOGTOWN_CHECKPOINT_MINUTES = 12;
/** 直线距离折算为估算路程的绕路系数（实测全城路面/直线中位数约 1.30） */
const STRAIGHT_DETOUR_FACTOR = 1.3;
/** 非表内近距直连阈值（米）：两地直线在该范围内或短于绕行锚点，按直线×绕路系数估算，避免倒退绕去远处锚点 */
const DIRECT_NEAR_METERS = 800;
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
  /** 本次驾驶实际使用的车辆；非驾驶路线不写。 */
  readonly vehicle?: string;
  readonly label: string;
  readonly minutes: number;
  readonly cost: number;
  readonly risk: Risk;
  readonly riskLabel: string;
  /** 路线风险提示（帮派地盘、狗镇关口、警情等） */
  readonly warnings?: readonly string[];
  /** 走不了时写原因 */
  readonly blocked?: string;
}

/** 算路线要看的状态 */
export interface TripWorld {
  readonly now: number;
  readonly scene: number;
  readonly location: string | null;
  readonly heat: number;
  readonly deeds: readonly KnownDeed[];
  readonly eddies: number;
  readonly inCombat: boolean;
  readonly travel: TravelState;
  readonly factions?: FactionsState;
  readonly ncpd?: NcpdState;
  /** 含玩家本人在内的同行人数（1 + 存活的同行 NPC 数），用于比对载具座位数 */
  readonly partySize?: number;
}

export function tripWorldOf(world: {
  readonly time: number;
  readonly slices: Readonly<Record<string, unknown>>;
}): TripWorld {
  const clock = WorldClockStateSchema.parse(world.slices.world);
  const npcSlice = world.slices.npc as
    | {
        readonly npcs?: Readonly<
          Record<
            string,
            {
              readonly location?: string | null;
              readonly alive?: boolean;
              readonly following?: boolean;
            }
          >
        >;
      }
    | undefined;
  const companions = Object.values(npcSlice?.npcs ?? {}).filter(
    (card) => card.alive !== false && card.following === true,
  ).length;
  return {
    now: world.time,
    scene: clock.scene,
    location: clock.location,
    heat: HeatStateSchema.parse(world.slices.heat).stars,
    deeds: CharacterStateSchema.parse(world.slices.character).deeds,
    eddies: EconomyStateSchema.parse(world.slices.economy).eddies,
    inCombat: CombatStateSchema.parse(world.slices.combat).active !== null,
    travel: TravelStateSchema.parse(
      world.slices.travel ?? {
        trips: [],
        encounterScene: null,
        encounter: null,
        vehicles: [],
        nextVehicleId: 1,
      },
    ),
    ...(world.slices.factions !== undefined
      ? { factions: FactionsStateSchema.parse(world.slices.factions) }
      : {}),
    ...(world.slices.ncpd !== undefined ? { ncpd: NcpdStateSchema.parse(world.slices.ncpd) } : {}),
    partySize: 1 + companions,
  };
}

function spot(place: LocationDef | undefined): { x: number; y: number } | undefined {
  return place?.x !== undefined && place.y !== undefined ? { x: place.x, y: place.y } : undefined;
}

/** 两地之间的直线距离（单位 100 米，1% 底图 = METERS_PER_PERCENT 米）；有一边不在地图上时是 undefined */
export function distanceBetween(a: LocationDef | undefined, b: LocationDef | undefined) {
  const p = spot(a);
  const q = spot(b);
  return p && q ? (Math.hypot(p.x - q.x, p.y - q.y) * METERS_PER_PERCENT) / 100 : undefined;
}

/**
 * 路面距离表（places-plan §七 简单版做法，用户定的“车和人先合在一起”）：content 包离线算好的锚点两两路面米数，
 * 放在 data.routes；meters 是上三角摊平，下标 i*n - i*(i+1)/2 + (j-i-1)
 */
interface RouteTableData {
  readonly anchors: readonly { readonly id: string; readonly rough: boolean }[];
  readonly meters: readonly number[];
  /** 和表里某个锚点同一位置的地点：地点 id → 锚点 id，查表时当作那个锚点（用户定的，2026-11-01） */
  readonly aliases?: Readonly<Record<string, string>>;
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
  for (const [place, anchor] of Object.entries(table.aliases ?? {})) {
    const i = index.get(anchor);
    if (i !== undefined && !index.has(place)) index.set(place, i);
  }
  routeIndexes.set(table, index);
  return index;
}

/** 路线表锚点的坐标：从地点表（含存档记下的地点）和周边锚点（poi:、ft:）里找；按 data 缓存 */
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
 * 出行用的距离（单位约 100 米）：两头都在路线表里按路面距离；表里没有的一头先直线走到离它最近的锚点，再按路面；
 * 都不行按地图直线（§七 简单版做法）
 */
export function tripDistance(
  data: Readonly<Record<string, unknown>>,
  a: LocationDef | undefined,
  b: LocationDef | undefined,
): { readonly d: number } | undefined {
  const straight = distanceBetween(a, b);
  if (!a || !b || straight === undefined) return undefined;
  const straightMeters = straight * 100;
  const directEstimate = (straightMeters * STRAIGHT_DETOUR_FACTOR) / 100;
  const table = routeTableOf(data);
  // 没有路线表（旧数据、测试）时按直线×绕路系数估算
  if (!table) return { d: directEstimate };
  const road = roadMetersBetween(data, a.id, b.id);
  if (road !== undefined) return { d: road / 100 };
  const index = routeIndexOf(table);
  const leg = (p: LocationDef) => {
    if (index.has(p.id)) return { id: p.id, meters: 0 };
    const s = spot(p);
    return s ? nearestAnchor(data, table, s) : undefined;
  };
  const la = leg(a);
  const lb = leg(b);
  const mid = la && lb ? roadMetersBetween(data, la.id, lb.id) : undefined;
  if (!la || !lb || mid === undefined) return { d: directEstimate };
  const viaAnchors = la.meters + mid + lb.meters;
  // 若两头同接在同一个锚点，或属于近距/倒绕（绕锚点比直线长出过多），改用直线×绕路系数，避免 100m 变 500m 或 1km 变 4.4km
  if (
    la.id === lb.id ||
    (straightMeters <= DIRECT_NEAR_METERS && viaAnchors > straightMeters * 1.8) ||
    viaAnchors > straightMeters * 2.5
  ) {
    return { d: Math.min(viaAnchors, straightMeters * STRAIGHT_DETOUR_FACTOR) / 100 };
  }
  return { d: viaAnchors / 100 };
}

const RISK_ORDER: readonly Risk[] = ["low", "medium", "high"];

function raiseRisk(a: Risk, b: Risk): Risk {
  return RISK_ORDER.indexOf(a) >= RISK_ORDER.indexOf(b) ? a : b;
}

function crossesDogtown(here: LocationDef | undefined, there: LocationDef | undefined): boolean {
  if (!here || !there || here.district === there.district) return false;
  return here.district === "狗镇" || there.district === "狗镇";
}

function routeHazard(
  w: TripWorld,
  data: Readonly<Record<string, unknown>>,
  mode: TravelMode,
  period: Period,
  here: LocationDef | undefined,
  there: LocationDef | undefined,
): { readonly risk: Risk; readonly warnings: readonly string[] } {
  let risk = riskOf(mode, period, w.heat);
  const warnings: string[] = [];

  if (crossesDogtown(here, there)) {
    if (mode === "stolen") {
      risk = "high";
      warnings.push("幽冥犬关口严查，开偷来的车极易暴露");
    } else if (w.heat >= 2) {
      risk = "high";
      warnings.push("通缉在身，过狗镇关口风险极高");
    } else {
      risk = raiseRisk(risk, "medium");
      warnings.push("需经狗镇幽冥犬关口检查");
    }
  }

  if (there && w.factions) {
    const turf = currentTurf(w.factions, data, true);
    for (const f of factionCatalog(data).values()) {
      if (!(turf.get(f.id) ?? f.turf).includes(there.district)) continue;
      const att = currentAttitude(w.factions, f);
      if (att === "kos") {
        risk = raiseRisk(risk, mode === "taxi" || mode === "metro" ? "medium" : "high");
        warnings.push(`${f.name}地盘（${attitudeLabel(f.kind, att)}）`);
      } else if (att === "hostile") {
        risk = raiseRisk(risk, mode === "walk" || mode === "stolen" ? "high" : "medium");
        warnings.push(`${f.name}地盘（${attitudeLabel(f.kind, att)}）`);
      }
    }
  }

  if (there && w.ncpd) {
    const alert = w.ncpd.alerts.find((a) => a.location === there.id);
    if (alert) {
      risk = raiseRisk(risk, alert.risk >= 3 ? "high" : "medium");
      warnings.push(`目的地有 NCPD 警情：${alert.label}`);
    }
  }

  return { risk, warnings };
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
  selection: { readonly vehicle?: string | undefined } | { readonly listVehicles: true } = {},
): RouteOption[] {
  // 原作店和地标第一次去也能预览路线；只查定义，不提前登记访问（places-plan 第二期）
  const here = w.location === null ? undefined : locationForTravel(data, w.location);
  const there = locationForTravel(data, to);
  const trip = tripDistance(data, here, there);
  const d = trip?.d;
  const period = periodOf(w.now);
  const cars = vehicleCatalog(data);
  const optionFor = (mode: TravelMode, vehicle?: string): RouteOption => {
    const speed = TRAVEL_SPEEDS[mode];
    // 每趟明确用哪辆车；现场唯一时自动确定，多辆不猜。
    const resolved =
      mode === "car" || mode === "stolen"
        ? resolveVehicleAt(w.travel.vehicles, w.location, vehicle, mode === "stolen")
        : undefined;
    const car = resolved?.ok ? resolved.vehicle : undefined;
    const carDef = car ? cars.get(car.model) : undefined;
    const carName = carDef?.name ?? car?.model;
    const factor = car ? vehicleFactor(car, carDef) : 1;
    // 时段路况与地形修正：仅作用于地面车辆，轻轨不受早晚高峰堵车影响
    const isRoadVehicle = mode === "car" || mode === "stolen" || mode === "taxi";
    const trafficFactor = !isRoadVehicle
      ? 1
      : period === "dusk"
        ? 1.25
        : period === "day"
          ? 1.1
          : period === "night"
            ? 0.85
            : 1;
    // 恶土荒原土路：普通轿跑/行政车降速，越野车与摩托基本不受影响
    const badlandsRoad =
      isRoadVehicle &&
      (here?.district === "恶土" || there?.district === "恶土") &&
      carDef?.class !== "offroad" &&
      carDef?.class !== "moto"
        ? 1.15
        : 1;
    const checkpointDelay = crossesDogtown(here, there) ? DOGTOWN_CHECKPOINT_MINUTES : 0;
    const minutes =
      d === undefined
        ? 0
        : Math.max(
            1,
            Math.round(
              speed.fixed +
                d * speed.perUnit * factor * trafficFactor * badlandsRoad +
                checkpointDelay,
            ),
          );
    const cost =
      mode === "taxi" && d !== undefined ? Math.ceil((TAXI_BASE + d * TAXI_PER_UNIT) / 5) * 5 : 0;
    const { risk, warnings: baseWarnings } = routeHazard(w, data, mode, period, here, there);
    const warnings = [...baseWarnings];
    const partySize = w.partySize ?? 1;
    if (carDef && partySize > carDef.seats) {
      warnings.push(
        `座位不足：当前同行 ${partySize} 人，${carDef.name} 仅 ${carDef.seats} 座（需分车、换大车或改打车）`,
      );
    }
    const base = {
      mode,
      ...(car ? { vehicle: car.id } : {}),
      label: carName ? `${TRAVEL_MODE_LABELS[mode]}（${carName}）` : TRAVEL_MODE_LABELS[mode],
      minutes,
      cost,
      risk,
      riskLabel: RISK_LABELS[risk],
      ...(warnings.length > 0 ? { warnings } : {}),
    };
    const blocked =
      blockOf(w, mode, here, there, d, cost) ??
      (resolved && !resolved.ok ? resolved.reason : undefined);
    return blocked ? { ...base, blocked } : base;
  };

  if (!("listVehicles" in selection))
    return MODES.map((mode) => optionFor(mode, selection.vehicle));

  const vehicles = drivableVehiclesAt(w.travel.vehicles, w.location);
  return MODES.flatMap((mode) => {
    if (mode !== "car" && mode !== "stolen") return [optionFor(mode)];
    const choices = vehicles.filter((v) => v.stolen === (mode === "stolen"));
    if (choices.length === 0) return [optionFor(mode)];
    const routes = choices.map((v) => ({ car: v, route: optionFor(mode, v.id) }));
    return routes.map(({ car, route }) => {
      if (!routes.some((other) => other.car.id !== car.id && other.route.label === route.label))
        return route;
      const prefix = `${car.model}-`;
      const number = car.id.startsWith(prefix) ? car.id.slice(prefix.length) : car.id;
      return { ...route, label: `${route.label} · #${number}` };
    });
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
  if (mode === "taxi" && crossesDogtown(here, there)) return "狗镇关口封锁，Delamain 不进出狗镇";
  if (mode === "metro" && !(here?.metro && there.metro)) return "两头不都有轻轨站";
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

/** 能抽到的偶遇：按目的地城区、到达时段、通缉星、外界传开的事迹范围、出行方式筛 */
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
      (e.minReach === undefined || hasDeedAtLeast(w.deeds, e.minReach, district)) &&
      (!e.modes || e.modes.includes(mode)),
  );
}

export function planTrip(
  w: TripWorld,
  data: Readonly<Record<string, unknown>>,
  request: TravelRequest,
  roll?: EncounterRoll,
): TripPlan {
  if (request.vehicle !== undefined && request.mode !== "car" && request.mode !== "stolen")
    return { ok: false, reason: "只有驾驶出行才能指定 vehicle" };
  const route = routeOptions(w, data, request.to, { vehicle: request.vehicle }).find(
    (r) => r.mode === request.mode,
  );
  if (!route) return { ok: false, reason: `没有这种出行方式：${request.mode}` };
  if (route.blocked) return { ok: false, reason: route.blocked };
  // 规划和路线预览用同一套地点查询，首次去原作地点也能结算（places-plan 第二期）
  const from = w.location === null ? undefined : locationForTravel(data, w.location);
  const to = locationForTravel(data, request.to);
  if (!from) return { ok: false, reason: "现在的位置不在地图上，用自由输入写怎么去" };
  if (!to) return { ok: false, reason: `没有这个出行地点：${request.to}` };
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
  const hazard =
    route.warnings && route.warnings.length > 0 ? `（沿途注意：${route.warnings.join("；")}）` : "";
  const lines = [
    `【出行】玩家在路线面板确认：${route.label}从${from.name}去${to.name}（${to.district}），路上 ${formatDuration(route.minutes)}，${formatGameTime(trip.arriveAt)}（${PERIOD_LABELS[periodOf(trip.arriveAt)]}）到，${money}，风险${route.riskLabel}${hazard}。时间和地点由代码记，world 里不要再写 location，time 只能写到达以后。`,
  ];
  // 偶遇是代码抽的素材，合适才写、可以改写或推迟（用户 2026-11-01 定的「全改」第 3 步：模型当主持人，代码只管记账）
  if (trip.encounter) {
    lines.push(
      `【路上偶遇】代码抽的素材：${trip.encounter.label}——${trip.encounter.note}。这一场合适就写出来，局面不合适可以改写或推迟；玩家可以不理，不理就照素材让事情在屏幕外发展。`,
    );
  }
  return lines.join("\n");
}

export function tripFact(trip: PlannedTrip) {
  return {
    to: trip.to.id,
    mode: trip.route.mode,
    encounter: trip.encounter?.id ?? null,
    ...(trip.route.vehicle ? { vehicle: trip.route.vehicle } : {}),
  };
}

/** 多近算"就在附近"：走过去，不转出行（用户定的 500 米，2026-10-30） */
export const NEAR_METERS = 500;
/** 自动转出行时挑哪种方式：有车开车，两头有站坐轻轨，钱够打车，都不行走路（本作改编） */
const AUTO_MODES: readonly TravelMode[] = ["car", "metro", "taxi", "walk"];

export type AutoMove =
  | { readonly kind: "near"; readonly to: string; readonly minutes: number }
  | { readonly kind: "trip"; readonly trip: PlannedTrip }
  | { readonly kind: "none" };

/**
 * 叙事模型直接在 world 里写了 location（用户定的"自动转"，2026-10-30）：
 * 500 米内算走过去，代码按步行算用时；更远的自动转成一次出行，照路线表扣时间和路费，不抽路上偶遇（正文已经写完了）。
 * 目的地不在地点表（含存档记下的地点）里、现在的位置不在地图上、或者哪种方式都走不了时是 none，照旧直接换位置
 */
/** 自动出行在脚下有多辆合法自有车时，优先挑选完好且最快的那一辆（避免因多车未点名而退回走路/打车） */
function pickAutoCar(w: TripWorld, data: Readonly<Record<string, unknown>>): string | undefined {
  const owned = drivableVehiclesAt(w.travel.vehicles, w.location).filter((v) => !v.stolen);
  if (owned.length === 0) return undefined;
  const cars = vehicleCatalog(data);
  const partySize = w.partySize ?? 1;
  const ranked = [...owned].sort((a, b) => {
    const da = cars.get(a.model);
    const db = cars.get(b.model);
    const fitA = (da?.seats ?? 2) >= partySize ? 1 : 0;
    const fitB = (db?.seats ?? 2) >= partySize ? 1 : 0;
    if (fitA !== fitB) return fitB - fitA;
    const intactA = a.condition === "intact" ? 1 : 0;
    const intactB = b.condition === "intact" ? 1 : 0;
    if (intactA !== intactB) return intactB - intactA;
    return vehicleFactor(a, da) - vehicleFactor(b, db);
  });
  return ranked[0]?.id;
}

export function autoMove(
  w: TripWorld,
  data: Readonly<Record<string, unknown>>,
  raw: string,
): AutoMove {
  const places = locationCatalog(data);
  const key = placeKey(raw);
  const to = places.get(raw.trim()) ?? [...places.values()].find((p) => placeKey(p.name) === key);
  if (!to || w.location === null || to.id === w.location) return { kind: "none" };
  const from = places.get(w.location) ?? locationForTravel(data, w.location);
  const dist = tripDistance(data, from, to);
  if (!dist) return { kind: "none" };
  if (dist.d * 100 <= NEAR_METERS) {
    const walk = routeOptions(w, data, to.id).find((r) => r.mode === "walk");
    return walk && !walk.blocked
      ? { kind: "near", to: to.id, minutes: walk.minutes }
      : { kind: "none" };
  }
  const autoCar = pickAutoCar(w, data);
  for (const mode of AUTO_MODES) {
    const planned = planTrip(w, data, {
      to: to.id,
      mode,
      ...(mode === "car" && autoCar ? { vehicle: autoCar } : {}),
    });
    if (planned.ok) return { kind: "trip", trip: planned.trip };
  }
  return { kind: "none" };
}

const fail = (reason: string): ApplyOutcome => ({ ok: false, reason });

export function applyTravel(
  draft: Draft<TravelState>,
  command: TravelCommand,
  ctx: SystemContext,
): ApplyOutcome {
  const clock = ctx.read<{ scene: number; location: string | null }>("world");
  const npcSlice = ctx.read<{
    readonly npcs?: Readonly<
      Record<string, { readonly alive?: boolean; readonly following?: boolean }>
    >;
  }>("npc");
  const companions = Object.values(npcSlice?.npcs ?? {}).filter(
    (card) => card.alive !== false && card.following === true,
  ).length;
  const w: TripWorld = {
    now: ctx.now,
    scene: clock.scene,
    location: clock.location,
    heat: ctx.read<{ stars: number }>("heat").stars,
    deeds: CharacterStateSchema.parse(ctx.read("character")).deeds,
    eddies: ctx.read<{ eddies: number }>("economy").eddies,
    inCombat: ctx.read<{ active: unknown }>("combat").active !== null,
    travel: draft as TravelState,
    factions: FactionsStateSchema.parse(ctx.read("factions") ?? {}),
    ncpd: NcpdStateSchema.parse(ctx.read("ncpd") ?? {}),
    partySize: 1 + companions,
  };
  const fact = TravelFactSchema.safeParse(ctx.facts.travel);
  const fixed =
    fact.success && fact.data.to === command.to && fact.data.mode === command.mode
      ? { fixed: fact.data.encounter }
      : { rng: ctx.rng, factor: 1 };
  if (
    fact.success &&
    fact.data.to === command.to &&
    fact.data.mode === command.mode &&
    fact.data.vehicle !== undefined &&
    command.vehicle !== undefined &&
    fact.data.vehicle !== command.vehicle
  )
    return fail("本次出行车辆与已确认的驾驶车辆不一致");
  const planned = planTrip(
    w,
    ctx.data,
    {
      ...command,
      ...(fact.success &&
      fact.data.to === command.to &&
      fact.data.mode === command.mode &&
      fact.data.vehicle
        ? { vehicle: fact.data.vehicle }
        : {}),
    },
    fixed,
  );
  if (!planned.ok) return fail(planned.reason);
  const { from, to, route, arriveAt, encounter } = planned.trip;
  const driver =
    route.mode === "car" || route.mode === "stolen"
      ? draft.vehicles.find((vehicle) => vehicle.id === route.vehicle)
      : undefined;
  if (
    (route.mode === "car" || route.mode === "stolen") &&
    (!driver || driver.abandoned || driver.location !== from.id || driver.condition === "wrecked")
  )
    return fail("本次车辆不在出发地点，无法开始这段驾驶");
  if (driver) driver.location = to.id;
  draft.trips.push({
    from: from.id,
    to: to.id,
    mode: route.mode,
    ...(driver ? { vehicle: driver.id } : {}),
    minutes: route.minutes,
    cost: route.cost,
    at: ctx.now,
    encounter: encounter?.id ?? null,
  });
  if (draft.trips.length > TRIPS_KEPT) draft.trips.splice(0, draft.trips.length - TRIPS_KEPT);
  const notes = [`${route.label}从${from.name}到${to.name}：${formatDuration(route.minutes)}`];
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
      ...(driver
        ? [
            { type: "inventory.relocateVehicle", vehicle: driver.id, location: to.id },
            { type: "cyberware.relocateVehicle", vehicle: driver.id, location: to.id },
          ]
        : []),
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
