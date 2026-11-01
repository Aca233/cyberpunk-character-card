/**
 * 地点簿（places-plan §四、§五、§八、§九、§十三②，用户定的方向 2026-10-29："原作有的地点用原作数据，
 * 玩家游玩途中到的新地点由存档自己记"）。
 * - 新地点由模型在 world 的 location 里写 {name, in} 建（用户定的，2026-10-30；place 指令只留给听说过的地方和找原作店），
 *   坐标由代码推算、贴原作路面（模型不给坐标），标"大概位置"；
 * - 原作服务点（poi:）、地标（ft:）第一次去时也记进来，坐标照原作，不标"大概"；
 * - 地点簿经 world 系统的 data 钩子并进 data.locations 和 data.radar，各系统照旧用 locationCatalog 查。
 * 地图形状、城区中心、服务点由 content 包放在 data.mapAreas、data.servicePoints。
 */
import type { Draft } from "immer";
import type { ApplyOutcome, RuleModule, SystemSection } from "../../kernel/system";
import { METERS_PER_PERCENT, radarAround } from "./radar";
import {
  type LocationDef,
  locationCatalog,
  type PlaceCommand,
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

function radarOf(data: Data): readonly { id: string; name: string; x: number; y: number }[] {
  return Array.isArray(data.radar)
    ? (data.radar as { id: string; name: string; x: number; y: number }[])
    : [];
}

function districtAt(areas: Areas, p: Pt): string {
  return areas.districts.find((d) => inside(d.poly, p.x, p.y))?.name ?? OUTSIDE;
}

function subAt(areas: Areas, p: Pt): string | undefined {
  return areas.subs.find((s) => inside(s.poly, p.x, p.y))?.name;
}

/** 写的街区在不在这个城区里；写错的丢掉，不拒收（用户定的，§四） */
function validSub(areas: Areas, district: string, sub: string | undefined): string | undefined {
  if (sub === undefined) return undefined;
  const d = areas.districts.find((a) => a.name === district);
  const s = areas.subs.find((a) => a.name === sub.trim());
  return d && s && s.district === d.id ? s.name : undefined;
}

// ———— 坐标推算（§四"坐标怎么定"、§十三②） ————

/** 同一个地方每次算出来一样：偏移用地点 id 做种子（§四） */
function seedOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0x100000000;
}

/** 近、中、远的米数（§十三②，本作改编） */
const DIST_METERS = { 近: 100, 中: 300, 远: 800 } as const;
/** 八方位的角度：东为 0，逆时针；底图 y 向下（同周边雷达） */
const DIR_ANGLES = { 东: 0, 东北: 1, 北: 2, 西北: 3, 西: 4, 西南: 5, 南: 6, 东南: 7 } as const;
/** near 往外偏多少（底图百分比，约 80–125 米，本作改编） */
const NEAR_MIN = 1.0;
const NEAR_SPAN = 0.6;
/** 两个点至少隔这么远才不算叠在一起（约 30 米，本作改编） */
const MIN_GAP = 0.4;

function offset(p: Pt, angle: number, r: number): Pt {
  return { x: p.x + r * Math.cos(angle), y: p.y - r * Math.sin(angle) };
}

/** 点在不在这个城区里；恶土是所有城区轮廓之外 */
function fits(areas: Areas, district: string, p: Pt): boolean {
  if (p.x < 0 || p.x > 100 || p.y < 0 || p.y > 100) return false;
  return districtAt(areas, p) === district;
}

/** 落到城区外面时往城区中心拉，拉不回来就用中心（§四：不落到城区边界外面） */
function fitInto(areas: Areas, district: string, p: Pt): Pt {
  if (fits(areas, district, p)) return p;
  const c = areas.centers.get(district) ?? p;
  for (let t = 0.1; t < 1; t += 0.1) {
    const q = { x: p.x + (c.x - p.x) * t, y: p.y + (c.y - p.y) * t };
    if (fits(areas, district, q)) return q;
  }
  return c;
}

/** 和已有的点叠在一起就绕着错开一点（§四），仍要在城区里 */
function spread(areas: Areas, district: string, p: Pt, taken: readonly Pt[], seed: number): Pt {
  const clear = (q: Pt) => taken.every((t) => Math.hypot(t.x - q.x, t.y - q.y) >= MIN_GAP);
  if (clear(p)) return p;
  for (let ring = 1; ring <= 6; ring++) {
    for (let k = 0; k < 8; k++) {
      const q = offset(p, seed * 2 * Math.PI + (k * Math.PI) / 4, ring * MIN_GAP);
      if (fits(areas, district, q) && clear(q)) return q;
    }
  }
  return p;
}

const round = (v: number) => Math.round(v * 100) / 100;

/** 已知地点的坐标：地点表（含地点簿）或周边锚点 */
function spotOf(data: Data, id: string): Pt | undefined {
  const def = locationCatalog(data).get(id);
  if (def?.x !== undefined && def.y !== undefined) return { x: def.x, y: def.y };
  const a = radarOf(data).find((r) => r.id === id);
  return a ? { x: a.x, y: a.y } : undefined;
}

/** 玩家现在所在地点（地点表里的） */
function hereOf(data: Data, clock: Pick<WorldClockState, "location">): LocationDef | undefined {
  return clock.location === null ? undefined : locationCatalog(data).get(clock.location);
}

/**
 * 按顺序取第一个有的（§四、§十三②）：from + dir + dist（from 要在周边雷达里）→ near 往外偏 →
 * 街区标签点 → 城区中心；再拉回城区里、和已有的点错开
 */
function inferSpot(
  areas: Areas,
  data: Data,
  clock: Pick<WorldClockState, "location" | "places">,
  command: PlaceCommand,
  district: string,
  sub: string | undefined,
  id: string,
): Pt {
  const seed = seedOf(id);
  let p: Pt | undefined;
  if (command.from !== undefined && command.dir !== undefined && command.dist !== undefined) {
    const radar = radarAround(data, hereOf(data, clock));
    const from = radar.some((h) => h.id === command.from) ? spotOf(data, command.from) : undefined;
    if (from) {
      p = offset(
        from,
        (DIR_ANGLES[command.dir] * Math.PI) / 4,
        DIST_METERS[command.dist] / METERS_PER_PERCENT,
      );
    }
  }
  if (!p && command.near !== undefined) {
    const near = spotOf(data, command.near);
    if (near) p = offset(near, seed * 2 * Math.PI, NEAR_MIN + seed * NEAR_SPAN);
  }
  // 没写 from、near：玩家就在这个城区时从玩家脚下找（用户定的：新地方从旁边已有的点推出来，2026-10-30）
  const here = hereOf(data, clock);
  // 只是听说（heard）的地方玩家没去，不能放到玩家脚下
  if (
    !p &&
    !command.heard &&
    here?.x !== undefined &&
    here.y !== undefined &&
    here.district === district
  ) {
    p = { x: here.x, y: here.y };
  }
  // 街区标签点、城区中心只当找路边的起点，不再直接当坐标（用户定的"先贴路面"）
  if (!p && sub !== undefined) p = areas.subs.find((s) => s.name === sub)?.label;
  p ??= areas.centers.get(district) ?? { x: 50, y: 50 };
  const taken = [...clock.places, ...radarOf(data)].map((t) => ({ x: t.x, y: t.y }));
  const road = snapToRoad(areas, data, district, sub, p, taken);
  const q = road ?? spread(areas, district, fitInto(areas, district, p), taken, seed);
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
 * 贴路面（用户定的"先贴路面，再挖原作"，2026-10-30）：从起点往外找最近的路边点，
 * 要在这个城区里（写了街区的也要在街区里），和已有的点隔开 MIN_GAP；坐标是本作改编，标大概位置
 */
function snapToRoad(
  areas: Areas,
  data: Data,
  district: string,
  sub: string | undefined,
  p: Pt,
  taken: readonly Pt[],
): Pt | undefined {
  const spots = roadSpotsOf(data);
  if (spots.length === 0) return undefined;
  const subPoly = sub ? areas.subs.find((s) => s.name === sub)?.poly : undefined;
  const near = spots
    .map((s) => ({ s, d: Math.hypot(s.x - p.x, s.y - p.y) }))
    .filter((c) => c.d <= ROAD_MAX)
    .sort((a, b) => a.d - b.d);
  const ok = (q: Pt, needSub: boolean) =>
    fits(areas, district, q) &&
    (!needSub || !subPoly || inside(subPoly, q.x, q.y)) &&
    taken.every((t) => Math.hypot(t.x - q.x, t.y - q.y) >= MIN_GAP);
  // 先在街区里找，街区里没有合适的路边再放宽到整个城区
  return near.find((c) => ok(c.s, true))?.s ?? near.find((c) => ok(c.s, false))?.s;
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

/** 临时地点转正（用户定的：用到第二次才转正，2026-10-30）：去掉 tempScene，进【地点簿】和周边 */
export function promotePlace(draft: Draft<WorldClockState>, id: string): void {
  const entry = bookOf(draft).find((p) => p.id === id);
  if (entry?.tempScene !== undefined) delete entry.tempScene;
}

/**
 * 玩家在地图上把剧情里记下的地点拖到准确的位置（places-plan 第二期，用户定的 2026-10-30）：不调用模型。
 * 只有 place: 能拖，原作店和地标照原作坐标；不能拖出这个地点所在的城区；挂在它下面的场景点坐标跟着一起改。
 * 记下 movedAt，rough 照旧：玩家放的位置不算核对过的原作入口
 */
export function movePlace(
  draft: Draft<WorldClockState>,
  command: { readonly id: string; readonly x: number; readonly y: number },
  data: Data,
  now: number,
): ApplyOutcome {
  const book = bookOf(draft);
  const entry = book.find((p) => p.id === command.id);
  if (!entry) return fail(`地点簿里没有 ${command.id}`);
  if (!entry.id.startsWith("place:")) return fail(`${entry.name}是原作的地点，坐标照原作，不能拖`);
  if (entry.parent !== undefined)
    return fail(`${entry.name}挂在 ${entry.parent} 下面，要拖就拖它所属的地点`);
  const p = { x: round(command.x), y: round(command.y) };
  const areas = areasOf(data);
  if (areas && districtAt(areas, p) !== entry.district) {
    return fail(`${entry.name}在${entry.district}，不能拖到${districtAt(areas, p)}`);
  }
  const old = { x: entry.x, y: entry.y };
  entry.x = p.x;
  entry.y = p.y;
  entry.movedAt = now;
  // 场景点的坐标就是上级的（用户定的，2026-10-30），跟着一起改
  for (const child of book) {
    if (child.parent === entry.id && child.x === old.x && child.y === old.y) {
      child.x = p.x;
      child.y = p.y;
    }
  }
  return { ok: true, notes: [`地点簿：${entry.name}挪到玩家在地图上放的位置`] };
}

/** 到了这里：换位置，地点簿里的记一下最近去过的时间；临时地点换了场景又来，就转正 */
function arrive(draft: Draft<WorldClockState>, id: string, at: number): void {
  draft.location = id;
  const entry = bookOf(draft).find((p) => p.id === id);
  if (!entry) return;
  entry.visitedAt = at;
  if (entry.tempScene !== undefined && entry.tempScene !== draft.scene) delete entry.tempScene;
}

/** 按名字（或别名）在地点表和地点簿里找；找不到是 undefined */
function findByName(data: Data, draft: Draft<WorldClockState>, name: string): string | undefined {
  const key = placeKey(name);
  for (const def of locationCatalog(data).values()) {
    if (def.id === name.trim() || placeKey(def.name) === key) return def.id;
  }
  // 地点簿本身也按名字和别名查：data 没并地点簿时（叙事流程外直接调用）同名也用原来那一条（§四）
  return bookOf(draft).find(
    (p) =>
      p.id === name.trim() ||
      placeKey(p.name) === key ||
      (p.alias !== undefined && placeKey(p.alias) === key),
  )?.id;
}

/** 原作服务点第一次去时的地点簿条目：名字只用原作的，没有时用"街区 + 类别"做显示标签（§五） */
function servicePlace(
  areas: Areas,
  point: ServicePointData,
  now: number,
  visited: boolean,
): SavedPlace {
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
    rough: false,
    firstSeenAt: now,
    visitedAt: visited ? now : null,
  };
}

/** poi:、ft: 的 id 第一次写进 location 时记进地点簿；不认识的返回 undefined */
function anchorPlace(data: Data, id: string, now: number): SavedPlace | undefined {
  const areas = areasOf(data);
  if (!areas) return undefined;
  if (id.startsWith("poi:")) {
    const point = servicePointsOf(data).find((p) => `poi:${p.id}` === id);
    return point ? servicePlace(areas, point, now, true) : undefined;
  }
  if (id.startsWith("ft:")) {
    const a = radarOf(data).find((r) => r.id === id);
    if (!a) return undefined;
    const sub = subAt(areas, a);
    return {
      id,
      name: a.name,
      district: districtAt(areas, a),
      ...(sub ? { sub } : {}),
      x: a.x,
      y: a.y,
      rough: false,
      firstSeenAt: now,
      visitedAt: now,
    };
  }
  return undefined;
}

/** 路线查询也能认没去过的原作地点（places-plan 第二期）：只读定义，不写地点簿、不标记访问；真正到达仍由 resolveLocation 登记 */
export function locationForTravel(data: Data, id: string): LocationDef | undefined {
  const known = locationCatalog(data).get(id);
  if (known) return known;
  const entry = anchorPlace(data, id, 0);
  if (!entry) return undefined;
  return {
    id: entry.id,
    name: entry.name,
    district: entry.district,
    x: entry.x,
    y: entry.y,
    rough: entry.rough,
  };
}

/**
 * world 指令的 location 换成地点 id：已有的 id 原样；poi:、ft: 第一次去的记进地点簿；
 * 中文名对得上地点表或地点簿的换成那个 id；都对不上的照旧存中文名（§九 兼容）。
 * 写了 poi:、ft: 却不认识时拒收
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
    return { ok: true, id: text, note: `地点簿：记下 ${entry.name}（${entry.district}）` };
  }
  return { ok: true, id: findByName(data, draft, text) ?? text };
}

/** 到地点簿里这一条时记最近去过的时间；临时地点换了场景又来就转正（用户定的，2026-10-30） */
export function markVisit(draft: Draft<WorldClockState>, id: string, at: number): void {
  const entry = bookOf(draft).find((p) => p.id === id);
  if (!entry) return;
  entry.visitedAt = at;
  if (entry.tempScene !== undefined && entry.tempScene !== draft.scene) delete entry.tempScene;
}

/** place 指令写 kind：在街区里挑最近的、还没进地点簿的同类原作店，街区里没有就往城区里找（§五） */
function applyKind(
  draft: Draft<WorldClockState>,
  command: PlaceCommand & { readonly kind: string },
  areas: Areas,
  data: Data,
  sub: string | undefined,
  now: number,
): ApplyOutcome {
  const district = command.district;
  const districtId = areas.districts.find((d) => d.name === district)?.id;
  const inDistrict = (p: ServicePointData) =>
    district === OUTSIDE ? p.district === null : p.district === districtId;
  const ofKind = servicePointsOf(data).filter((p) => p.kind === command.kind && inDistrict(p));
  const subId = sub ? areas.subs.find((s) => s.name === sub)?.id : undefined;
  const inSub = subId ? ofKind.filter((p) => p.sub === subId) : [];
  const pool = inSub.length > 0 ? inSub : ofKind;
  const kindName = areas.kindNames.get(command.kind) ?? command.kind;
  if (pool.length === 0) return fail(`${sub ?? district}这一带没有${kindName}`);
  // 从哪儿量"最近"：玩家就在这个城区时从玩家这里，否则从街区标签点或城区中心
  const here = hereOf(data, draft);
  const ref: Pt =
    here?.x !== undefined && here.y !== undefined && here.district === district
      ? { x: here.x, y: here.y }
      : ((sub ? areas.subs.find((s) => s.name === sub)?.label : undefined) ??
        areas.centers.get(district) ?? { x: 50, y: 50 });
  const book = bookOf(draft);
  const sorted = [...pool].sort(
    (a, b) =>
      Math.hypot(a.x - ref.x, a.y - ref.y) - Math.hypot(b.x - ref.x, b.y - ref.y) ||
      a.id.localeCompare(b.id),
  );
  const pick =
    sorted.find((p) => !book.some((e) => e.id === `poi:${p.id}`)) ??
    (sorted[0] as ServicePointData);
  const id = `poi:${pick.id}`;
  let entry = book.find((e) => e.id === id);
  const fresh = !entry;
  if (!entry) {
    book.push(servicePlace(areas, pick, now, !command.heard));
    entry = book[book.length - 1] as Draft<SavedPlace>;
  }
  // 模型起的称呼只当别名（本作改编），不改原作名字（§五）
  if (
    command.name !== undefined &&
    entry.alias === undefined &&
    placeKey(command.name) !== placeKey(entry.name)
  ) {
    entry.alias = command.name.trim();
  }
  if (command.note !== undefined && entry.note === undefined) entry.note = command.note;
  if (!command.heard) arrive(draft, id, now);
  const where = `${entry.district}${entry.sub ? ` · ${entry.sub}` : ""}`;
  return {
    ok: true,
    notes: [`${fresh ? "地点簿：记下" : "地点簿里已有"} ${entry.name}（${kindName}，${where}）`],
  };
}

/** place 指令（§四、§五、§十三②） */
export function applyPlace(
  draft: Draft<WorldClockState>,
  command: PlaceCommand,
  data: Data,
  now: number,
): ApplyOutcome {
  const areas = areasOf(data);
  if (!areas) return fail("没有地图数据，建不了地点");
  const district = command.district.trim();
  if (!areas.centers.has(district)) {
    return fail(
      `district 要写城区的中文名（${[...areas.centers.keys()].join("、")}），写的是「${district}」`,
    );
  }
  const sub = validSub(areas, district, command.sub);
  if (command.kind !== undefined) {
    return applyKind(draft, { ...command, district, kind: command.kind }, areas, data, sub, now);
  }
  const name = (command.name ?? "").trim();
  const book = bookOf(draft);
  // 场景点（天台、后巷……）挂在上级下面（用户定的，2026-10-30）：同一个上级下面同名的算同一处，坐标照上级
  const parentId =
    command.parent !== undefined
      ? (findByName(data, draft, command.parent) ?? command.parent.trim())
      : undefined;
  const parentEntry = parentId !== undefined ? book.find((p) => p.id === parentId) : undefined;
  const parentSpot = parentId !== undefined ? (spotOf(data, parentId) ?? parentEntry) : undefined;
  if (parentId !== undefined && parentSpot) {
    const same = book.find((p) => p.parent === parentId && placeKey(p.name) === placeKey(name));
    if (same) {
      if (command.note !== undefined && same.note === undefined) same.note = command.note;
      if (!command.heard) arrive(draft, same.id, now);
      return { ok: true, notes: [`地点簿里已有 ${name}（挂在 ${parentId} 下面）`] };
    }
    const id = nextId(book);
    book.push({
      id,
      name,
      district,
      ...(sub ? { sub } : {}),
      parent: parentId,
      // 场景点也先临时，换了场景又来才转正（用户定的，2026-10-30）
      ...(command.heard ? {} : { tempScene: draft.scene }),
      ...(command.note !== undefined ? { note: command.note } : {}),
      x: parentSpot.x,
      y: parentSpot.y,
      rough: parentEntry?.rough ?? locationCatalog(data).get(parentId)?.rough ?? false,
      firstSeenAt: now,
      visitedAt: command.heard ? null : now,
    });
    if (!command.heard || draft.location === name) arrive(draft, id, now);
    return { ok: true, notes: [`地点簿：新场景点 ${name}（挂在 ${parentId} 下面）`] };
  }
  const existing = findByName(data, draft, name);
  if (existing !== undefined) {
    const entry = book.find((p) => p.id === existing);
    if (entry && command.note !== undefined && entry.note === undefined) entry.note = command.note;
    if (!command.heard) arrive(draft, existing, now);
    return { ok: true, notes: [`地点簿里已有 ${name}`] };
  }
  const id = nextId(book);
  const spot = inferSpot(areas, data, draft, command, district, sub, id);
  const near = command.near !== undefined && spotOf(data, command.near) ? command.near : undefined;
  book.push({
    id,
    name,
    district,
    ...(sub ? { sub } : {}),
    ...(near ? { near } : {}),
    // 亲自到的新地点先临时，换了场景又来才转正（用户定的，2026-10-30）；听说的是玩家特意记下的，不算临时
    ...(command.heard ? {} : { tempScene: draft.scene }),
    ...(command.note !== undefined ? { note: command.note } : {}),
    x: spot.x,
    y: spot.y,
    rough: true,
    firstSeenAt: now,
    visitedAt: command.heard ? null : now,
  });
  // 这一轮 world 已经把位置写成这个中文名时，也换成新 id
  if (!command.heard || draft.location === name) arrive(draft, id, now);
  return {
    ok: true,
    notes: [`地点簿：新地点 ${name}（${district}${sub ? ` · ${sub}` : ""}，大概位置）`],
  };
}

// ———— 并进地点表（world 系统的 data 钩子） ————

const merged = new WeakMap<object, { readonly key: string; readonly out: Data }>();
const clampPct = (v: number) => Math.min(100, Math.max(0, v));

/** 地点簿并进 data.locations 和 data.radar（§四、§十三①"地点簿做了以后并进锚点"）；空簿原样返回 */
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
        ...(p.note !== undefined ? { note: p.note } : {}),
        x: clampPct(p.x),
        y: clampPct(p.y),
        ...(p.rough ? { rough: true } : {}),
      })),
  ];
  const radar = radarOf(data);
  const inRadar = new Set(radar.map((a) => a.id));
  const out: Data = {
    ...data,
    locations,
    radar: [
      ...radar,
      // 场景点（挂在上级下面的）坐标就是上级的，不单独进周边；没转正的临时地点也不进（用户定的，2026-10-30）
      ...places
        .filter((p) => !inRadar.has(p.id) && p.parent === undefined && p.tempScene === undefined)
        .map((p) => ({ id: p.id, name: p.name, kind: null, x: p.x, y: p.y })),
    ],
  };
  merged.set(data, { key, out });
  return out;
}

/** 不经过注册表的地方（叙事流程、出行检查）用：按这个世界的地点簿并好 */
export function withSavedPlaces(
  data: Data,
  world: { readonly slices: Readonly<Record<string, unknown>> },
): Data {
  const slice = world.slices.world as { readonly places?: readonly SavedPlace[] } | undefined;
  return withPlaces(data, slice?.places);
}

// ———— 提示词（§八） ————

/** 地点簿最多列几条（用户定的，2026-10-30） */
export const PLACE_BOOK_LIMIT = 20;

function placeLine(p: SavedPlace): string {
  const where = `${p.district}${p.sub ? ` · ${p.sub}` : ""}`;
  const tags = [
    where,
    // 场景点挂在上级下面（用户定的，2026-10-30）
    p.parent ? `在 ${p.parent} 里` : undefined,
    // 玩家拖过的照实说是玩家放的，不冒充原作入口（places-plan 第二期）
    p.movedAt !== undefined ? "玩家在地图上放的位置" : p.rough ? "大概位置" : undefined,
    p.visitedAt === null ? "听说过、没去过" : undefined,
    p.alias ? `也叫${p.alias}（本作改编）` : undefined,
    p.note,
  ].filter((t): t is string => t !== undefined);
  return `- ${p.id}：${p.name}（${tags.join("，")}）`;
}

/** 【地点簿】：最近去过或听说过的 20 条，多的按城区折叠（§八）；现在位置是表外中文名时提醒补 place */
export function placeBookText(
  clock: Pick<WorldClockState, "location" | "places">,
  data: Data | undefined,
): string | undefined {
  // 没转正的临时地点不列（用户定的，2026-10-30），玩家正在那里的除外
  const sorted = [...clock.places]
    .filter((p) => p.tempScene === undefined || p.id === clock.location)
    .sort(
      (a, b) =>
        (b.visitedAt ?? b.firstSeenAt) - (a.visitedAt ?? a.firstSeenAt) || a.id.localeCompare(b.id),
    );
  const shown = sorted.slice(0, PLACE_BOOK_LIMIT);
  const folded = new Map<string, number>();
  for (const p of sorted.slice(PLACE_BOOK_LIMIT))
    folded.set(p.district, (folded.get(p.district) ?? 0) + 1);
  const lines = shown.map(placeLine);
  for (const [district, n] of folded) {
    lines.push(`- ${district}还有 ${n} 处去过或听说过的地方（没列出来，地图和出行照常能去）`);
  }
  const loc = clock.location;
  const stray =
    data !== undefined &&
    loc !== null &&
    !locationCatalog(data).has(loc) &&
    !clock.places.some((p) => p.id === loc);
  if (stray) {
    lines.push(
      `现在的位置「${loc}」不在常用地点和地点簿里：这一轮 world 的 location 写成 {"name": "${loc}", "in": "城区"}（in 必填），代码会记进地点簿。`,
    );
  }
  if (lines.length === 0) return undefined;
  const head =
    shown.length > 0
      ? "玩家去过或听说过的地方（代码记的）；id 可以写进 world 的 location、meet 的 location，也可以当 place 的 near：\n"
      : "";
  return `${head}${lines.join("\n")}`;
}

export const placeSections: readonly SystemSection[] = [
  {
    order: 75,
    title: "地点簿",
    render: ({ world, data }) =>
      placeBookText(WorldClockStateSchema.parse(world.slices.world), data),
  },
];

export const placeRules: RuleModule<WorldClockState> = {
  id: "places",
  title: "新地点和地点簿",
  commands: ["place"],
  // 什么时候会到新地方说不准，宁可多带（RuleModule 的约定）
  when: () => true,
  // 用户定的（2026-10-30）：新地点并进 world 的 location，place 只留给听说过的地方和找原作店
  text: `- 到了【常用地点】【地点簿】【周边】里都没有的新地方：world 的 location 直接写 {"name": "中文名", "in": "城区"}，in 必填（沃森、威斯特布鲁克、市政中心、海伍德、圣多明戈、太平洲、狗镇、恶土），sub 街区选填；不写坐标，代码从附近已知的点（near、from，或玩家现在的位置）找最近的原作路边放下，标"大概位置"。地点簿里有同名的，代码会用原来那一条。
- 新地点在哪个已知地点附近就写 near（地点 id、poi:、ft:、place: 都行）；也可以相对【当前状态】周边里的一个 id 写 from + dir（八方位）+ dist（近、中、远，约 100、300、800 米）。
- 某个地方里面或紧挨着的场景点（天台、后巷、包间、地下室……）写 parent（所属地点的 id 或中文名），例如 {"name": "天台", "in": "沃森", "parent": "lizzies-bar"}：坐标照所属地点，地图上不单独标；同一个地方下面同名的算同一处，不同地方的"天台"是不同的地方。
- 要去某一类店（武器店 gun、义体医生 ripperdoc、近战武器 melee、网络黑客 netrunner、服装 clothes、医疗点 meds、垃圾商店 junk、饮食 food、酒吧 bar、公寓 apartment、公寓出租 rent、中间人 fixer、好车中间人终端 autofixer），不要自己编店：写 place 带 kind 和 district（可加 sub），代码在那一带挑一家原作的店；店名照代码给的，你起的称呼只当别名。
- 周边里 poi:、ft: 开头的 id 可以直接写进 world 的 location，代码会记进地点簿。
- 只是听说、玩家没去的地方：写 place，name + district，加 heard: true，只记下、不换位置。`,
};
