/**
 * 统一的地点（用户定的，2026-11-01："不要搞什么常用地点之类的，统一为地点"）。
 * - 原作固定地点、原作服务点（poi:）、原作地标（ft:）、剧情里新到的地方（place:）是同一种东西，模型只看【地点】一节；
 * - 模型只有两种写法：world 的 location 写 id，或者新地方写 {name, in}；坐标由代码放在玩家附近或城区中心最近的原作路边；
 * - 存档记下的地点经 world 系统的 data 钩子并进 data.locations 和 data.radar，各系统照旧用 locationCatalog 查。
 * 地图形状、城区中心、服务点由 content 包放在 data.mapAreas、data.servicePoints。
 */
import type { Draft } from "immer";
import type { ApplyOutcome, RuleModule, SystemSection } from "../../kernel/system";
import { METERS_PER_PERCENT, radarAround } from "./radar";
import {
  type LocationDef,
  locationCatalog,
  type NewPlace,
  type SavedPlace,
  type WorldClockState,
  WorldClockStateSchema,
} from "./schema";

type Data = Readonly<Record<string, unknown>>;
type Pt = { readonly x: number; readonly y: number };
type Polygon = readonly (readonly [number, number])[];

// ———— 地图数据（content 包的 mapShapes.gen.ts、map.ts、servicePoints.gen.ts） ————

interface ShapeData {
  readonly id: string;
  readonly name: string;
  readonly district?: string;
  readonly label: readonly [number, number];
  readonly points: string;
}

interface MapAreasData {
  readonly districts: readonly ShapeData[];
  readonly subdistricts: readonly ShapeData[];
  readonly centers: Readonly<Record<string, Pt>>;
  readonly kinds: readonly { readonly id: string; readonly name: string }[];
}

interface ServicePointData {
  readonly id: string;
  readonly kind: string;
  readonly name: string | null;
  readonly district: string | null;
  readonly sub: string | null;
  readonly x: number;
  readonly y: number;
}

interface Area {
  readonly id: string;
  readonly name: string;
  readonly label: Pt;
  readonly poly: Polygon;
}

interface Areas {
  readonly centers: ReadonlyMap<string, Pt>;
  readonly districts: readonly Area[];
  readonly subs: readonly (Area & { readonly district: string })[];
  readonly kindNames: ReadonlyMap<string, string>;
}

/** 没有城区轮廓的城区：轮廓外的都算这里（同 MapPanel 的 districtAt，本作简化） */
const OUTSIDE = "恶土";

function parsePoints(points: string): Polygon {
  return points
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [x, y] = pair.split(",").map(Number);
      return [x ?? 0, y ?? 0] as const;
    });
}

/** 射线法：点在不在多边形里（同 MapPanel.tsx 的 inside） */
function inside(poly: Polygon, x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (!a || !b) continue;
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) {
      hit = !hit;
    }
  }
  return hit;
}

const areaCache = new WeakMap<object, Areas>();

function areasOf(data: Data): Areas | undefined {
  const raw = data.mapAreas as Partial<MapAreasData> | undefined;
  if (!raw || !Array.isArray(raw.districts) || !raw.centers) return undefined;
  const cached = areaCache.get(raw);
  if (cached) return cached;
  const toArea = (s: ShapeData): Area => ({
    id: s.id,
    name: s.name,
    label: { x: s.label[0], y: s.label[1] },
    poly: parsePoints(s.points),
  });
  const areas: Areas = {
    centers: new Map(Object.entries(raw.centers)),
    districts: raw.districts.map(toArea),
    subs: (raw.subdistricts ?? []).map((s) => ({ ...toArea(s), district: s.district ?? "" })),
    kindNames: new Map((raw.kinds ?? []).map((k) => [k.id, k.name])),
  };
  areaCache.set(raw, areas);
  return areas;
}

function servicePointsOf(data: Data): readonly ServicePointData[] {
  return Array.isArray(data.servicePoints) ? (data.servicePoints as ServicePointData[]) : [];
}

/** 原作服务点的 id（poi:）和类别：地图上原作图标点了能去，第一次去也行（places-plan 第二期，用户定的 2026-10-30） */
export function serviceAnchors(
  data: Data,
): readonly { readonly id: string; readonly kind: string }[] {
  return servicePointsOf(data).map((p) => ({ id: `poi:${p.id}`, kind: p.kind }));
}

/**
 * 原作地标（ft:，数据终端和地铁站）的 id 和类别名：地图上放大后画出来，点了照常出行，不传送
 * （用户定的"画出来，走普通出行"，2026-11-02；仍然不要快速移动）
 */
export function landmarkAnchors(
  data: Data,
): readonly { readonly id: string; readonly kind: string | null }[] {
  return radarOf(data)
    .filter((a) => a.id.startsWith("ft:"))
    .map((a) => ({ id: a.id, kind: (a as { kind?: string | null }).kind ?? null }));
}

function radarOf(
  data: Data,
): readonly { id: string; name: string; kind?: string | null; x: number; y: number }[] {
  return Array.isArray(data.radar)
    ? (data.radar as { id: string; name: string; kind?: string | null; x: number; y: number }[])
    : [];
}

function districtAt(areas: Areas, p: Pt): string {
  return areas.districts.find((d) => inside(d.poly, p.x, p.y))?.name ?? OUTSIDE;
}

function subAt(areas: Areas, p: Pt): string | undefined {
  return areas.subs.find((s) => inside(s.poly, p.x, p.y))?.name;
}

/** 按中文名或 id 查指定城区内的街区多边形；找不到返回 undefined */
function findSubArea(
  areas: Areas,
  district: string,
  rawSub: string | undefined,
): (Area & { readonly district: string }) | undefined {
  const text = rawSub?.trim();
  if (!text) return undefined;
  const distId = areas.districts.find((d) => d.name === district)?.id;
  const key = text.toLowerCase();
  return areas.subs.find(
    (s) =>
      (distId === undefined || s.district === distId) &&
      (s.name === text ||
        s.id.toLowerCase() === key ||
        s.name.includes(text) ||
        text.includes(s.name)),
  );
}

// ———— 坐标推算 ————

/** 同一个地方每次算出来一样：偏移用地点 id 做种子（§四） */
function seedOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0x100000000;
}

/** 两个点至少隔这么远才不算叠在一起（约 30 米，本作改编） */
const MIN_GAP = 0.4;

function offset(p: Pt, angle: number, r: number): Pt {
  return { x: p.x + r * Math.cos(angle), y: p.y - r * Math.sin(angle) };
}

/** 点在不在这个城区（以及可选街区）里；恶土是所有城区轮廓之外 */
function fits(areas: Areas, district: string, p: Pt, subArea?: Area): boolean {
  if (p.x < 0 || p.x > 100 || p.y < 0 || p.y > 100) return false;
  if (districtAt(areas, p) !== district) return false;
  return subArea ? inside(subArea.poly, p.x, p.y) : true;
}

/** 落到城区/街区外面时往中心拉，拉不回来就用中心（§四：不落到边界外面） */
function fitInto(areas: Areas, district: string, p: Pt, subArea?: Area): Pt {
  if (fits(areas, district, p, subArea)) return p;
  const c = subArea?.label ?? areas.centers.get(district) ?? p;
  for (let t = 0.1; t < 1; t += 0.1) {
    const q = { x: p.x + (c.x - p.x) * t, y: p.y + (c.y - p.y) * t };
    if (fits(areas, district, q, subArea)) return q;
  }
  return c;
}

/** 和已有的点叠在一起就绕着错开一点（§四），仍要在城区/街区里 */
function spread(
  areas: Areas,
  district: string,
  p: Pt,
  taken: readonly Pt[],
  seed: number,
  subArea?: Area,
): Pt {
  const clear = (q: Pt) => taken.every((t) => Math.hypot(t.x - q.x, t.y - q.y) >= MIN_GAP);
  if (clear(p)) return p;
  for (let ring = 1; ring <= 6; ring++) {
    for (let k = 0; k < 8; k++) {
      const q = offset(p, seed * 2 * Math.PI + (k * Math.PI) / 4, ring * MIN_GAP);
      if (fits(areas, district, q, subArea) && clear(q)) return q;
    }
  }
  return p;
}

const round = (v: number) => Math.round(v * 100) / 100;

/** 玩家现在所在地点（地点表里的） */
function hereOf(data: Data, clock: Pick<WorldClockState, "location">): LocationDef | undefined {
  return clock.location === null ? undefined : locationCatalog(data).get(clock.location);
}

/**
 * 新地方的坐标：
 * - 指定了街区（sub）时：玩家就在该街区则从玩家脚下找，否则从该街区中心找并优先贴在街区内路面；
 * - 未指定街区时：玩家就在该城区则从玩家脚下找，否则从城区中心找；
 * 贴不上就拉回边界内并和已有地点错开。偏移用地点 id 做种子，同一个地方每次算出来一样
 */
function inferSpot(
  areas: Areas,
  data: Data,
  clock: Pick<WorldClockState, "location" | "places">,
  district: string,
  id: string,
  subArea?: Area,
): Pt {
  const here = hereOf(data, clock);
  const herePt =
    here?.x !== undefined && here.y !== undefined ? { x: here.x, y: here.y } : undefined;
  const inTargetSub =
    subArea !== undefined && herePt !== undefined && inside(subArea.poly, herePt.x, herePt.y);
  const p: Pt = subArea
    ? inTargetSub && herePt
      ? herePt
      : subArea.label
    : herePt && here?.district === district
      ? herePt
      : (areas.centers.get(district) ?? { x: 50, y: 50 });
  const taken = [...clock.places, ...radarOf(data)].map((t) => ({ x: t.x, y: t.y }));
  const road =
    snapToRoad(areas, data, district, p, taken, subArea) ??
    (subArea ? snapToRoad(areas, data, district, p, taken) : undefined);
  const q =
    road ??
    spread(areas, district, fitInto(areas, district, p, subArea), taken, seedOf(id), subArea);
  return { x: round(q.x), y: round(q.y) };
}

/** 原作路面的路边点（data.roadSpots，x、y 交替摊平）；按 data 缓存成点表 */
const roadCache = new WeakMap<object, readonly Pt[]>();

function roadSpotsOf(data: Data): readonly Pt[] {
  const raw = data.roadSpots;
  if (!Array.isArray(raw)) return [];
  const cached = roadCache.get(raw);
  if (cached) return cached;
  const out: Pt[] = [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    out.push({ x: raw[i] as number, y: raw[i + 1] as number });
  }
  roadCache.set(raw, out);
  return out;
}

/** 离起点太远的路边不要（约 600 米，本作改编）：远了说明起点附近没有路，退回旧的推算 */
const ROAD_MAX = 600 / METERS_PER_PERCENT;

/**
 * 贴路面（用户定的"先贴路面"，2026-10-30）：从起点往外找最近的路边点，
 * 要在这个城区里，和已有的点隔开 MIN_GAP；坐标是本作改编
 */
function snapToRoad(
  areas: Areas,
  data: Data,
  district: string,
  p: Pt,
  taken: readonly Pt[],
  subArea?: Area,
): Pt | undefined {
  const spots = roadSpotsOf(data);
  if (spots.length === 0) return undefined;
  return spots
    .map((s) => ({ s, d: Math.hypot(s.x - p.x, s.y - p.y) }))
    .filter((c) => c.d <= ROAD_MAX)
    .sort((a, b) => a.d - b.d)
    .find(
      (c) =>
        fits(areas, district, c.s, subArea) &&
        taken.every((t) => Math.hypot(t.x - c.s.x, t.y - c.s.y) >= MIN_GAP),
    )?.s;
}

// ———— 结算 ————

/** 同名归一：去掉首尾和重复空白，英文不分大小写（§四） */
export function placeKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

const fail = (reason: string): ApplyOutcome => ({ ok: false, reason });

/** 旧存档的草稿没有 places（§九） */
function bookOf(draft: Draft<WorldClockState>): Draft<SavedPlace>[] {
  if (!Array.isArray(draft.places)) draft.places = [];
  return draft.places;
}

function nextId(places: readonly { readonly id: string }[]): string {
  let n = places.filter((p) => p.id.startsWith("place:")).length + 1;
  while (places.some((p) => p.id === `place:${n}`)) n++;
  return `place:${n}`;
}

/** 按名字在地点表和存档记下的地点里找；找不到是 undefined */
function findByName(data: Data, draft: Draft<WorldClockState>, name: string): string | undefined {
  const key = placeKey(name);
  for (const def of locationCatalog(data).values()) {
    if (def.id === name.trim() || placeKey(def.name) === key) return def.id;
  }
  // data 没并存档地点时（叙事流程外直接调用）同名也用原来那一条
  return bookOf(draft).find((p) => p.id === name.trim() || placeKey(p.name) === key)?.id;
}

/** 原作服务点第一次去时记下的条目：名字只用原作的，没有时用"街区 + 类别"做显示标签（§五） */
function servicePlace(areas: Areas, point: ServicePointData, now: number): SavedPlace {
  const sub = point.sub ? areas.subs.find((s) => s.id === point.sub)?.name : undefined;
  const district =
    (point.district ? areas.districts.find((d) => d.id === point.district)?.name : undefined) ??
    OUTSIDE;
  const kindName = areas.kindNames.get(point.kind) ?? point.kind;
  return {
    id: `poi:${point.id}`,
    name: point.name ?? `${sub ?? ""}${kindName}`,
    district,
    ...(sub ? { sub } : {}),
    kind: point.kind,
    x: point.x,
    y: point.y,
    firstSeenAt: now,
    visitedAt: now,
  };
}

/** poi:、ft: 的 id 第一次写进 location 时记下；不认识的返回 undefined */
function anchorPlace(data: Data, id: string, now: number): SavedPlace | undefined {
  const areas = areasOf(data);
  if (!areas) return undefined;
  if (id.startsWith("poi:")) {
    const point = servicePointsOf(data).find((p) => `poi:${p.id}` === id);
    return point ? servicePlace(areas, point, now) : undefined;
  }
  if (id.startsWith("ft:")) {
    const a = radarOf(data).find((r) => r.id === id);
    if (!a) return undefined;
    const sub = subAt(areas, a);
    const metro = a.kind === "地铁站";
    return {
      id,
      name: a.name,
      district: districtAt(areas, a),
      ...(sub ? { sub } : {}),
      ...(metro ? { metro: true } : {}),
      x: a.x,
      y: a.y,
      firstSeenAt: now,
      visitedAt: now,
    };
  }
  return undefined;
}

/** 路线查询也能认没去过的原作地点：只读定义，不写存档、不标记访问；真正到达仍由 resolveLocation 记下 */
export function locationForTravel(data: Data, id: string): LocationDef | undefined {
  const known = locationCatalog(data).get(id);
  if (known) return known;
  const entry = anchorPlace(data, id, 0);
  if (!entry) return undefined;
  return {
    id: entry.id,
    name: entry.name,
    district: entry.district,
    ...(entry.sub ? { sub: entry.sub } : {}),
    x: entry.x,
    y: entry.y,
    ...(entry.metro ? { metro: true } : {}),
    ...(entry.kind ? { kind: entry.kind } : {}),
  };
}

/** 从自由文本里拆出可能附带的城区名（如 "沃森 · 无名小巷" / "日本街暗巷"）用于兜底落点 */
function inferFallbackDistrict(
  areas: Areas,
  data: Data,
  draft: Draft<WorldClockState>,
  text: string,
): { readonly district: string; readonly name: string; readonly sub?: string } {
  for (const d of areas.centers.keys()) {
    if (text.includes(d)) {
      const cleaned = text
        .replace(d, "")
        .replace(/^[\s·\-—–:：/]+|[\s·\-—–:：/]+$/g, "")
        .trim();
      return { district: d, name: cleaned || text };
    }
  }
  for (const s of areas.subs) {
    if (text.includes(s.name)) {
      const dName = areas.districts.find((d) => d.id === s.district)?.name;
      if (dName) return { district: dName, name: text, sub: s.name };
    }
  }
  const here = hereOf(data, draft);
  return { district: here?.district ?? OUTSIDE, name: text };
}

/**
 * world 指令的 location 换成地点 id：
 * - 已有 id 原样；poi:、ft: 第一次去记下（不存在则拒收）；
 * - 中文名对得上地点表或存档地点的换成那个 id；
 * - 未匹配但具备地图数据时，自动兜底落点建 place:N，避免玩家掉出地图失去路由能力。
 */
export function resolveLocation(
  draft: Draft<WorldClockState>,
  raw: string,
  data: Data,
  now: number,
):
  | { readonly ok: true; readonly id: string; readonly note?: string }
  | { readonly ok: false; readonly reason: string } {
  const text = raw.trim();
  const book = bookOf(draft);
  if (locationCatalog(data).has(text) || book.some((p) => p.id === text))
    return { ok: true, id: text };
  if (text.startsWith("poi:") || text.startsWith("ft:")) {
    const entry = anchorPlace(data, text, now);
    if (!entry) return { ok: false, reason: `没有这个原作地点：${text}` };
    book.push(entry);
    return { ok: true, id: text, note: `记下地点 ${entry.name}（${entry.district}）` };
  }
  const matched = findByName(data, draft, text);
  if (matched !== undefined) return { ok: true, id: matched };
  const areas = areasOf(data);
  if (!areas) return { ok: true, id: text };
  const inferred = inferFallbackDistrict(areas, data, draft, text);
  const cleanedMatch = findByName(data, draft, inferred.name);
  if (cleanedMatch !== undefined) return { ok: true, id: cleanedMatch };
  const subArea = findSubArea(areas, inferred.district, inferred.sub);
  const id = nextId(book);
  const spot = inferSpot(areas, data, draft, inferred.district, id, subArea);
  const sub = subAt(areas, spot) ?? subArea?.name;
  book.push({
    id,
    name: inferred.name,
    district: inferred.district,
    ...(sub ? { sub } : {}),
    x: spot.x,
    y: spot.y,
    firstSeenAt: now,
    visitedAt: now,
  });
  return {
    ok: true,
    id,
    note: `自动落点 ${inferred.name}（${inferred.district}${sub ? ` · ${sub}` : ""}）`,
  };
}

/** 到了存档记下的地点：记最近去过的时间 */
export function markVisit(draft: Draft<WorldClockState>, id: string, at: number): void {
  const entry = bookOf(draft).find((p) => p.id === id);
  if (entry) entry.visitedAt = at;
}

/**
 * 新地点（world 的 location 写 {name, in, note?}，用户定的"统一为地点"，2026-11-02）：
 * 同名的用原来那一条；否则建 place:N，坐标由代码推算、贴原作路面，模型不给坐标
 */
export function createPlace(
  draft: Draft<WorldClockState>,
  place: NewPlace,
  data: Data,
  now: number,
): ApplyOutcome {
  const areas = areasOf(data);
  if (!areas) return fail("没有地图数据，建不了地点");
  const district = place.in.trim();
  if (!areas.centers.has(district)) {
    return fail(
      `in 要写城区的中文名（${[...areas.centers.keys()].join("、")}），写的是「${district}」`,
    );
  }
  const name = place.name.trim();
  const book = bookOf(draft);
  const existing = findByName(data, draft, name);
  if (existing !== undefined) {
    const entry = book.find((p) => p.id === existing);
    if (entry && place.note !== undefined && entry.note === undefined) entry.note = place.note;
    draft.location = existing;
    markVisit(draft, existing, now);
    return { ok: true, notes: [`地点里已有 ${name}，用原来那一条`] };
  }
  const id = nextId(book);
  const subArea = findSubArea(areas, district, place.sub);
  const spot = inferSpot(areas, data, draft, district, id, subArea);
  const sub = subAt(areas, spot) ?? subArea?.name;
  book.push({
    id,
    name,
    district,
    ...(sub ? { sub } : {}),
    ...(place.note !== undefined ? { note: place.note } : {}),
    x: spot.x,
    y: spot.y,
    firstSeenAt: now,
    visitedAt: now,
  });
  draft.location = id;
  return { ok: true, notes: [`记下新地点 ${name}（${district}${sub ? ` · ${sub}` : ""}）`] };
}

// ———— 并进地点表（world 系统的 data 钩子） ————

const merged = new WeakMap<object, { readonly key: string; readonly out: Data }>();
const clampPct = (v: number) => Math.min(100, Math.max(0, v));

/** 存档记下的地点并进 data.locations 和 data.radar，和原作地点同一张表；没有记下的原样返回 */
export function withPlaces(data: Data, places: readonly SavedPlace[] | undefined): Data {
  if (!places || places.length === 0) return data;
  const key = JSON.stringify(places);
  const hit = merged.get(data);
  if (hit && hit.key === key) return hit.out;
  const base = Array.isArray(data.locations) ? (data.locations as LocationDef[]) : [];
  const have = new Set(base.map((l) => l.id));
  const locations: LocationDef[] = [
    ...base,
    ...places
      .filter((p) => !have.has(p.id))
      .map((p) => ({
        id: p.id,
        name: p.name,
        district: p.district,
        ...(p.sub !== undefined ? { sub: p.sub } : {}),
        ...(p.note !== undefined ? { note: p.note } : {}),
        x: clampPct(p.x),
        y: clampPct(p.y),
        ...(p.metro === true ? { metro: true } : {}),
        ...(p.kind !== undefined ? { kind: p.kind } : {}),
      })),
  ];
  const radar = radarOf(data);
  const inRadar = new Set(radar.map((a) => a.id));
  const out: Data = {
    ...data,
    locations,
    radar: [
      ...radar,
      ...places
        .filter((p) => !inRadar.has(p.id))
        .map((p) => ({ id: p.id, name: p.name, kind: p.kind ?? null, x: p.x, y: p.y })),
    ],
  };
  merged.set(data, { key, out });
  return out;
}

/** 不经过注册表的地方（叙事流程、出行检查）用：按这个世界存档记下的地点并好 */
export function withSavedPlaces(
  data: Data,
  world: { readonly slices: Readonly<Record<string, unknown>> },
): Data {
  const slice = world.slices.world as { readonly places?: readonly SavedPlace[] } | undefined;
  return withPlaces(data, slice?.places);
}

// ———— 提示词（§八） ————

/** 【地点】里列几条最近去过的（用户定的，2026-10-30） */
export const RECENT_PLACES = 20;

function kindLabel(areas: Areas | undefined, kind: string | null | undefined): string | undefined {
  if (!kind) return undefined;
  return areas?.kindNames.get(kind) ?? kind;
}

function placeLine(id: string, name: string, tags: readonly (string | undefined)[]): string {
  const shown = tags.filter((t): t is string => t !== undefined && t !== "");
  return `- ${id}：${name}${shown.length > 0 ? `（${shown.join("，")}）` : ""}`;
}

/**
 * 【地点】（用户定的"统一为地点"，2026-11-02）：原作固定地点全列，加玩家附近 1500 米内最近的 10 个、
 * 最近去过的 20 个，去重；现在的位置是表外中文名时提醒写成新地点
 */
export function placesText(
  clock: Pick<WorldClockState, "location" | "places">,
  data: Data | undefined,
): string | undefined {
  if (!data) return undefined;
  const areas = areasOf(data);
  const saved = new Set(clock.places.map((p) => p.id));
  const seen = new Set<string>();
  const lines: string[] = [];
  const here = (id: string) => (id === clock.location ? "你在这里" : undefined);
  for (const def of locationCatalog(data).values()) {
    if (saved.has(def.id) || seen.has(def.id)) continue;
    seen.add(def.id);
    lines.push(
      placeLine(def.id, def.name, [
        def.district,
        kindLabel(areas, def.kind),
        def.note,
        here(def.id),
      ]),
    );
  }
  for (const hit of radarAround(data, hereOf(data, clock))) {
    if (seen.has(hit.id)) continue;
    seen.add(hit.id);
    const def = locationForTravel(data, hit.id);
    const near = hit.dir === "就在旁边" ? "就在旁边" : `${hit.dir} ${hit.meters} 米`;
    lines.push(
      placeLine(hit.id, hit.name, [def?.district, kindLabel(areas, hit.kind), def?.note, near]),
    );
  }
  const recent = [...clock.places].sort(
    (a, b) =>
      (b.visitedAt ?? b.firstSeenAt) - (a.visitedAt ?? a.firstSeenAt) || a.id.localeCompare(b.id),
  );
  for (const p of recent.slice(0, RECENT_PLACES)) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    lines.push(placeLine(p.id, p.name, [p.district, kindLabel(areas, p.kind), p.note, here(p.id)]));
  }
  const rest = recent.filter((p) => !seen.has(p.id)).length;
  if (rest > 0) lines.push(`- 另有 ${rest} 处以前去过的地方没列出来，地图和出行照常能去`);
  const loc = clock.location;
  if (loc !== null && !locationCatalog(data).has(loc) && !saved.has(loc)) {
    lines.push(
      `现在的位置「${loc}」不在【地点】里：这一轮 world 的 location 写成 {"name": "${loc}", "in": "城区"}（in 必填），代码会记下来。`,
    );
  }
  if (lines.length === 0) return undefined;
  return `能去的地方（代码记的）；id 写进 world 的 location、meet 的 location：\n${lines.join("\n")}`;
}

export const placeSections: readonly SystemSection[] = [
  {
    order: 75,
    title: "地点",
    render: ({ world, data }) => placesText(WorldClockStateSchema.parse(world.slices.world), data),
  },
];

export const placeRules: RuleModule<WorldClockState> = {
  id: "places",
  title: "地点",
  commands: ["world"],
  // 什么时候会到新地方说不准，宁可多带（RuleModule 的约定）
  when: () => true,
  // 用户定的"统一为地点"（2026-11-02）：location 只有两种写法，店从【地点】里挑
  text: `- 去【地点】里有的地方：world 的 location 写它的 id。要找某一类店（武器店、义体医生、酒吧……），从【地点】里按括号里的类别挑，不要自己编店。
- 【地点】里没有的新地方：location 写 {"name": "中文名", "in": "城区", "sub": "街区（可选）"}，in 必填（沃森、威斯特布鲁克、市政中心、海伍德、圣多明戈、太平洲、狗镇、恶土），跨街区或明确街区时写 sub（如 北区、歌舞伎、小唐人街、日本街、谷地），可加 note；不写坐标，代码定位置，同名的用原来那一条。`,
};
