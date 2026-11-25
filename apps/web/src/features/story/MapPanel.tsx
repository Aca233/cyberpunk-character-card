import {
  DISTRICT_SHAPES,
  MAP_POI_KINDS,
  MAP_POIS,
  type MapPoi,
  type MapPoiKind,
  SUBDISTRICT_SHAPES,
} from "@cp/content/mapShapes";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type AssetId, asset } from "../../assets";
import { Asset, cssUrl, MissingAsset, NineSlice } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { CellFrame } from "../../ui/FrameBox";
import { useLayer } from "../../ui/layers";
// 视角、瓦片和图标抽到 mapCamera.ts，和捏人选开局地点的地图共用（2026-10-30，用户定的"在地图上选择"）
import {
  DISTRICT_AREA_ZOOM,
  FOCUS_ZOOM,
  iconStyle,
  MAP,
  onOverlay,
  POI_ZOOM,
  pinVars,
  poiIcon,
  SUB_AREA_ZOOM,
  SUB_ZOOM,
  shapesViewBox,
  tileImages,
  useMapCamera,
  useMapTiles,
} from "./mapCamera";
import styles from "./story.module.css";
import { vehicleArtOf } from "./vehicle-art";
import { districtIcon, type MapAreaTarget, type MapFocus, type View } from "./view";

export type MapDestination = View["travel"]["destinations"][number];
export type MapRoute = MapDestination["routes"][number];
/** NCPD 警情用原作地图上的悬赏标记 */
const POLICE_ICON: AssetId = "map.poi.police";

/**
 * 城区和街区的边界：底图上叠一层 SVG，坐标是底图宽、高的百分比。
 * viewBox 默认是整张底图；全屏地图传视野那一块，SVG 只有屏幕大，放大后不会变成上万像素的大图
 */
export function MapShapes({
  labels = true,
  viewBox = "0 0 100 100",
  active,
  activeSub,
}: {
  readonly labels?: boolean;
  readonly viewBox?: string;
  /** 鼠标停着或正文聚焦的城区（名字），整块提亮 */
  readonly active?: string | undefined;
  /** 正文聚焦的街区（名字），整块提亮 */
  readonly activeSub?: string | undefined;
}) {
  return (
    <>
      <svg
        className={styles.mapShapes}
        viewBox={viewBox}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {DISTRICT_SHAPES.filter((d) => d.name === active).map((d) => (
          <polygon key={`${d.id}-hover`} points={d.points} className={styles.mapDistrictHover} />
        ))}
        {SUBDISTRICT_SHAPES.filter((s) => s.name === activeSub).map((s) => (
          <polygon key={`${s.id}-focus`} points={s.points} className={styles.mapSubFocus} />
        ))}
        {SUBDISTRICT_SHAPES.map((s) => (
          <polygon key={s.id} points={s.points} className={styles.mapSubdistrict} />
        ))}
        {DISTRICT_SHAPES.map((d) => (
          <polygon key={`${d.id}-glow`} points={d.points} className={styles.mapDistrictGlow} />
        ))}
        {DISTRICT_SHAPES.map((d) => (
          <polygon key={d.id} points={d.points} className={styles.mapDistrict} />
        ))}
      </svg>
      {labels &&
        DISTRICT_SHAPES.map((d) => (
          <span
            key={d.id}
            className={styles.mapDistrictLabel}
            style={{ left: `${d.label[0]}%`, top: `${d.label[1]}%` }}
          >
            {d.name}
          </span>
        ))}
    </>
  );
}

const KIND_NAME = new Map(MAP_POI_KINDS.map((k) => [k.id, k.name]));
const SUB_NAME = new Map(SUBDISTRICT_SHAPES.map((s) => [s.id, s.name]));

type Polygon = readonly (readonly [number, number])[];

function parsePoints(points: string): Polygon {
  return points
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [x, y] = pair.split(",").map(Number);
      return [x ?? 0, y ?? 0] as const;
    });
}

/** 射线法：点在不在多边形里 */
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

const DISTRICT_AREAS = DISTRICT_SHAPES.map((d) => ({ name: d.name, poly: parsePoints(d.points) }));
const SUB_AREAS = SUBDISTRICT_SHAPES.map((s) => ({ name: s.name, poly: parsePoints(s.points) }));

/**
 * 鼠标下面是哪个城区：用原作世界地图的城区悬停区域（3dmap_view.ent）判断。
 * 原作没有恶土的悬停区域，城区以外的地方都算恶土（海面也算，本作简化）
 */
interface Hover {
  readonly district: string;
  readonly sub: string | null;
}

function districtAt(x: number, y: number): Hover | null {
  if (x < 0 || x > 100 || y < 0 || y > 100) return null;
  const district = DISTRICT_AREAS.find((d) => inside(d.poly, x, y))?.name;
  if (!district) return { district: "恶土", sub: null };
  return { district, sub: SUB_AREAS.find((s) => inside(s.poly, x, y))?.name ?? null };
}

/** 帮派标志：原作 gang_logos 图集，按势力 id 对上 */
const GANG_LOGOS: Readonly<Record<string, AssetId>> = {
  maelstrom: "gang.maelstrom",
  "tyger-claws": "gang.tygerClaws",
  valentinos: "gang.valentinos",
  "sixth-street": "gang.sixthStreet",
  animals: "gang.animals",
  "voodoo-boys": "gang.voodooBoys",
  mox: "gang.mox",
  scavengers: "gang.scavengers",
  wraiths: "gang.wraiths",
  aldecaldos: "gang.aldecaldos",
  barghest: "gang.barghest",
};

/** 委托地点用原作地图上的任务标记（mappin_icons 的 quest，同类图标已在图集里，用户同意的 2026-10-30） */
const JOB_ICON: AssetId = "map.poi.quest";
/** 住处与停放载具复用原作图集图标 */
const HOME_ICON: AssetId = "map.poi.apartment";
const VEHICLE_ICON: AssetId = "map.poi.autofixer";

/**
 * 图例每一项都能开关：当前位置、地点、数据终端（未去过的非地铁 ft:）、住处、载具、委托、人物、NCPD 警情和每类服务点。
 * 见过的人按现在在的地点画，中间人也一样
 */
type LegendKey =
  | "here"
  | "dest"
  | "terminals"
  | "homes"
  | "vehicles"
  | "jobs"
  | "npcs"
  | "police"
  | MapPoiKind;
const LEGEND_KEYS = new Set<string>([
  "here",
  "dest",
  "terminals",
  "homes",
  "vehicles",
  "jobs",
  "npcs",
  "police",
  ...MAP_POI_KINDS.map((k) => k.id),
]);
/** 关掉的图例项记在浏览器里，下次打开地图照旧 */
const HIDDEN_STORE = "cp.mapHidden";
/** 图例展开状态记在浏览器里，默认收起以释放夜之城地图视野 */
const LEGEND_OPEN_STORE = "cp.mapLegendOpen";
/** 精简态势预设：仅保留当前位置、核心地点、住处、载具、委托、人物与 NCPD 警情 */
const CORE_LEGEND_KEYS: ReadonlySet<LegendKey> = new Set([
  "here",
  "dest",
  "homes",
  "vehicles",
  "jobs",
  "npcs",
  "police",
]);

function loadLegendOpen(): boolean {
  try {
    return localStorage.getItem(LEGEND_OPEN_STORE) === "1";
  } catch {
    return false;
  }
}

function riskToneOf(risk: string): "low" | "mid" | "high" {
  if (risk === "high" || risk === "extreme") return "high";
  if (risk === "medium" || risk === "mid" || risk === "moderate") return "mid";
  return "low";
}

/** 未访问过的非地铁站快速移动终端：低缩放时不铺满全图，放大或搜索时再显示 */
function isUnvisitedTerminal(d: MapDestination): boolean {
  return d.firstVisit && d.layer === "ft" && !d.metro;
}

function isLegendKey(v: unknown): v is LegendKey {
  return typeof v === "string" && LEGEND_KEYS.has(v);
}

function loadHidden(): ReadonlySet<LegendKey> {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(HIDDEN_STORE) ?? "[]");
    return new Set(Array.isArray(list) ? list.filter(isLegendKey) : []);
  } catch {
    return new Set();
  }
}

const POI_COUNT = new Map<MapPoiKind, number>();
for (const poi of MAP_POIS) POI_COUNT.set(poi.kind, (POI_COUNT.get(poi.kind) ?? 0) + 1);

/**
 * 筛选格子和方框的九宫格切线：原作 atlas_shapes_sync.inkatlas 的 nineSliceScaleRect（2160p 图的像素），
 * 原文是 左、上、右、下，这里换成 CSS 的 上、右、下、左。cell 20/20/30/30，color 9/9/18/21
 */
const CELL_SLICE = [20, 30, 30, 20] as const;
const BOX_SLICE = [9, 18, 21, 9] as const;
/**
 * 路线卡照原作世界地图的默认 tooltip（world_map.inkwidget 的 WorldMapTooltipController）：
 * shadow_blobs 的 shadowBlobSquare_small 阴影、atlas_shapes_sync 的 tooltip_map_bg 底和 tooltip_map_fg 框。
 * 切线 2160p 左上右下：tooltip_map 10/10/30/70，阴影 20/20/20/20
 */
const TOOLTIP_SLICE = [10, 30, 70, 10] as const;
const SHADOW_SLICE = 20;
/** 城区卡照原作 districtInfo 不加框，文字下垫 shadowBlobText 黑色阴影；切线 2160p 左上右下 28/18/28/16 */
const TEXT_SHADOW_SLICE = [18, 28, 16, 28] as const;
/** 原作 atlas_shapes_sync 的 cell_flip_bg / cell_flip_fg（左下斜角）切线：2160p 左/上/右/下 30/20/20/30，这里是 CSS 顺序 */
const PANEL_SLICE = [20, 20, 30, 30] as const;

/** 地点图钉的悬停说明：名字、城区/街区，当前位置再标一下 */
function destTitle(d: MapDestination): string {
  const area = d.sub ? `${d.district} · ${d.sub}` : d.district;
  return `${d.name} · ${area}${d.metro ? " · NCART 地铁站" : ""}${d.here ? "（当前位置）" : ""}`;
}

/** 格式化出行耗时：超过 60 分钟转为「X 小时 Y 分钟」 */
function formatMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? `${h} 小时 ${rem} 分钟` : `${h} 小时`;
}

/** 根据当前游戏时钟分钟数推算预计到达钟点（HH:mm，跨日加注） */
function formatEta(nowMinutes: number, addMinutes: number): string {
  const arrive = nowMinutes + Math.max(0, Math.round(addMinutes));
  const hhmm = new Date(arrive * 60000).toISOString().slice(11, 16);
  const dayDiff = Math.floor(arrive / 1440) - Math.floor(nowMinutes / 1440);
  return dayDiff > 0 ? `次日 ${hhmm}` : hhmm;
}

interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

function overlaps(a: Box, list: readonly Box[]): boolean {
  return list.some((b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0);
}

/** 神经界面的地图页：铺满页面主体，滚轮缩放、拖动平移；耗时、路费和风险由代码按路线表算，不调用模型 */
export function MapBody({
  view,
  onTravel,
  onClose,
  focus,
}: {
  readonly view: View;
  /** 正在生成时不传，路线不能点 */
  readonly onTravel?: ((dest: MapDestination, route: MapRoute) => void) | undefined;
  /** 收起地图：顶栏工具那一排最右边出「关闭」按钮，同 M、Esc（用户定的，计划第十二节）；不传不出 */
  readonly onClose?: (() => void) | undefined;
  /** 打开时聚焦的目标（正文里点了地名/区域或追踪定位）：放大定位，不传送 */
  readonly focus?: MapFocus | undefined;
}) {
  const [shapes, setShapes] = useState(true);
  const [hover, setHover] = useState<Hover | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<LegendKey>>(loadHidden);
  const [legendOpen, setLegendOpen] = useState<boolean>(loadLegendOpen);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchIdx, setSearchIdx] = useState(0);
  const [focusedArea, setFocusedArea] = useState<MapAreaTarget | null>(() =>
    focus?.kind === "area" ? focus.area : null,
  );
  const [herePing, setHerePing] = useState(0);
  const [picked, setPicked] = useState<string | null>(() =>
    focus?.kind === "place" && view.travel.destinations.some((d) => d.id === focus.id && !d.here)
      ? focus.id
      : null,
  );
  const tiles = useMapTiles();
  const destinations = view.travel.destinations;
  const destById = useMemo(() => new Map(destinations.map((d) => [d.id, d])), [destinations]);
  const here = destinations.find((d) => d.here);
  const dest = picked !== null ? destById.get(picked) : undefined;
  // 委托地点：只标手头已经接下的委托，免得未接的对话传闻像预设任务点那样挂在地图上
  const jobsAt = useMemo(() => {
    const openJobs = view.jobs.list.filter((j) => j.status === "active" && j.location !== null);
    const out = new Map<string, (typeof openJobs)[number][]>();
    for (const j of openJobs) {
      const exact = j.location !== null ? destById.get(j.location) : undefined;
      // 旧委托可能写的是中文地名：若同名地点存在唯一核心固定地点（fixed）优先落到固定地点，避免与同名 poi:/ft: 冲突导致丢标
      let resolved = exact;
      if (!resolved && j.location !== null) {
        const named = destinations.filter((x) => x.name === j.location);
        if (named.length === 1) {
          resolved = named[0];
        } else if (named.length > 1) {
          const fixed = named.filter((x) => x.layer === "fixed");
          if (fixed.length === 1) resolved = fixed[0];
        }
      }
      if (resolved) out.set(resolved.id, [...(out.get(resolved.id) ?? []), j]);
    }
    return out;
  }, [view.jobs.list, destById, destinations]);
  const destJobs = dest ? (jobsAt.get(dest.id) ?? []) : [];
  // 人物（用户 2026-11-02："npc是能移动的"，中间人也是普通人物）：见过、活着的人按现在在的地点合并成一个标记；
  // 地点 id 对不上地图上的地点就不画，不猜坐标。在玩家眼前的人跟着当前位置走
  const npcsAt = useMemo(() => {
    const out = new Map<string, View["npcs"][number][]>();
    for (const n of view.npcs) {
      if (!n.alive || n.placeId === null) continue;
      const d = destById.get(n.placeId);
      if (d) out.set(d.id, [...(out.get(d.id) ?? []), n]);
    }
    return out;
  }, [view.npcs, destById]);
  const destNpcs = dest ? (npcsAt.get(dest.id) ?? []) : [];
  // 住处 / 安全屋：按地点合并，标在地图上并在路线卡里提示
  const homesAt = useMemo(() => {
    const out = new Map<string, View["safehouse"]["homes"][number][]>();
    for (const h of view.safehouse.homes) {
      const d = destById.get(h.location);
      if (d) out.set(d.id, [...(out.get(d.id) ?? []), h]);
    }
    return out;
  }, [view.safehouse.homes, destById]);
  const destHomes = dest ? (homesAt.get(dest.id) ?? []) : [];
  // 停放载具：按当前停放地点合并，玩家一眼能看到车停在哪
  const vehiclesAt = useMemo(() => {
    const out = new Map<string, View["travel"]["vehicles"][number][]>();
    for (const v of view.travel.vehicles) {
      if (!v.location) continue;
      const d = destById.get(v.location);
      if (d) out.set(d.id, [...(out.get(d.id) ?? []), v]);
    }
    return out;
  }, [view.travel.vehicles, destById]);
  const destVehicles = dest ? (vehiclesAt.get(dest.id) ?? []) : [];
  const destAlerts = dest ? view.ncpd.alerts.filter((a) => a.location === dest.id) : [];
  const destGigs = dest ? view.sidegigs.list.filter((g) => g.location === dest.id) : [];
  const info = asset(MAP);
  // 城区势力：包含帮派以及明确占据城区的公司/势力（如市政中心的荒坂），不再只过滤 kind === "gang"
  const turfFactions = useMemo(
    () => view.factions.list.filter((f) => f.turf.length > 0),
    [view.factions.list],
  );

  // 搜索匹配：按地名、城区、街区、服务类别、以及所在的人物/委托/住处/停放载具过滤
  const trimmedQuery = query.trim().toLowerCase();
  const searchResults = useMemo(() => {
    if (!trimmedQuery) return [];
    const scored: { readonly dest: MapDestination; readonly score: number }[] = [];
    for (const d of destinations) {
      const name = d.name.toLowerCase();
      const district = d.district.toLowerCase();
      const sub = (d.sub ?? "").toLowerCase();
      const kind = (d.kind ? (KIND_NAME.get(d.kind as MapPoiKind) ?? d.kind) : "").toLowerCase();
      const hasNpc = (npcsAt.get(d.id) ?? []).some((n) =>
        n.name.toLowerCase().includes(trimmedQuery),
      );
      const hasJob = (jobsAt.get(d.id) ?? []).some((j) =>
        j.title.toLowerCase().includes(trimmedQuery),
      );
      const hasHome = (homesAt.get(d.id) ?? []).some((h) =>
        h.name.toLowerCase().includes(trimmedQuery),
      );
      const hasCar = (vehiclesAt.get(d.id) ?? []).some((v) =>
        v.name.toLowerCase().includes(trimmedQuery),
      );
      let score = 0;
      if (name === trimmedQuery) score = 100;
      else if (name.startsWith(trimmedQuery)) score = 80;
      else if (name.includes(trimmedQuery)) score = 60;
      else if (hasNpc || hasJob || hasHome || hasCar) score = 55;
      else if (sub.includes(trimmedQuery)) score = 40;
      else if (district.includes(trimmedQuery)) score = 30;
      else if (kind.includes(trimmedQuery)) score = 20;
      else continue;
      if (!d.firstVisit) score += 10;
      if (d.metro) score += 5;
      scored.push({ dest: d, score });
    }
    scored.sort((a, b) => b.score - a.score || a.dest.name.localeCompare(b.dest.name, "zh-CN"));
    return scored.slice(0, 20).map((s) => s.dest);
  }, [destinations, trimmedQuery, npcsAt, jobsAt, homesAt, vehiclesAt]);

  useEffect(() => {
    try {
      localStorage.setItem(HIDDEN_STORE, JSON.stringify([...hidden]));
    } catch {
      // 存不下（隐私模式之类）就只在这次打开里有效
    }
  }, [hidden]);

  useEffect(() => {
    try {
      localStorage.setItem(LEGEND_OPEN_STORE, legendOpen ? "1" : "0");
    } catch {
      // 同上
    }
  }, [legendOpen]);

  // 搜索空输入时的快捷重点目标：正在进行的委托、住处与停放载具
  const quickTargets = useMemo(() => {
    const seen = new Set<string>();
    const out: {
      readonly dest: MapDestination;
      readonly badge: string;
      readonly tone: "job" | "home" | "vehicle";
    }[] = [];
    const push = (id: string, badge: string, tone: "job" | "home" | "vehicle") => {
      if (seen.has(id)) return;
      const d = destById.get(id);
      if (!d) return;
      seen.add(id);
      out.push({ dest: d, badge, tone });
    };
    for (const id of jobsAt.keys()) push(id, "委托", "job");
    for (const id of homesAt.keys()) push(id, "住处", "home");
    for (const id of vehiclesAt.keys()) push(id, "载具", "vehicle");
    return out.slice(0, 6);
  }, [destById, jobsAt, homesAt, vehiclesAt]);

  const toggleLegend = (key: LegendKey) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // ———— 视角：滚轮缩放、拖动平移、键盘（共用 mapCamera.ts，算法照旧） ————
  const {
    viewport,
    size,
    cam,
    zoom,
    dragging,
    zoomBy,
    reset,
    lookAt,
    toScreen,
    onScreen,
    pointAt,
    dragStart,
    dragMove,
    dragEnd,
    keyPan,
  } = useMapCamera();

  // 打开地图带 focus 时，视口量出尺寸后自动聚焦并放大到对应地点或区域
  const focusedNonceRef = useRef<number | null>(null);
  const lookAtRef = useRef(lookAt);
  lookAtRef.current = lookAt;
  useLayoutEffect(() => {
    if (!focus || size.w === 0 || focusedNonceRef.current === focus.nonce) return;
    if (focus.kind === "place") {
      const target = destById.get(focus.id);
      if (!target) return;
      focusedNonceRef.current = focus.nonce;
      setFocusedArea(null);
      if (target.here) {
        setPicked(null);
        setHidden((prev) => {
          if (!prev.has("here")) return prev;
          const next = new Set(prev);
          next.delete("here");
          return next;
        });
        setHerePing((n) => n + 1);
      } else {
        setPicked(target.id);
      }
      lookAtRef.current(target.x, target.y, FOCUS_ZOOM);
      return;
    }
    focusedNonceRef.current = focus.nonce;
    setPicked(null);
    setShapes(true);
    setFocusedArea(focus.area);
    lookAtRef.current(
      focus.area.x,
      focus.area.y,
      focus.area.level === "sub" ? SUB_AREA_ZOOM : DISTRICT_AREA_ZOOM,
    );
  }, [focus, size.w, destById]);

  const focusHere = () => {
    if (!here) return;
    setFocusedArea(null);
    setHidden((prev) => {
      if (!prev.has("here")) return prev;
      const next = new Set(prev);
      next.delete("here");
      return next;
    });
    setHerePing((n) => n + 1);
    lookAt(here.x, here.y, Math.max(zoom, FOCUS_ZOOM));
  };

  const selectDestination = (target: MapDestination) => {
    setSearchOpen(false);
    setQuery("");
    setSearchIdx(0);
    if (target.here) {
      setPicked(null);
      focusHere();
      return;
    }
    setFocusedArea(null);
    setPicked(target.id);
    lookAt(target.x, target.y, Math.max(zoom, FOCUS_ZOOM));
  };

  const focusDistrict = (district: (typeof DISTRICT_SHAPES)[number]) => {
    setSearchOpen(false);
    setQuery("");
    setSearchIdx(0);
    setPicked(null);
    setShapes(true);
    setFocusedArea({
      id: district.id,
      level: "district",
      name: district.name,
      x: district.label[0],
      y: district.label[1],
    });
    lookAt(district.label[0], district.label[1], DISTRICT_AREA_ZOOM);
  };

  useEffect(() => {
    if (picked !== null) setFocusedArea(null);
  }, [picked]);

  // Esc 分层退回：先收起搜索下拉 → 再取消选中地点 → 再取消聚焦区域 → 最后关闭地图
  useLayer(() => setSearchOpen(false), searchOpen);
  useLayer(() => setPicked(null), !searchOpen && picked !== null);
  useLayer(() => setFocusedArea(null), !searchOpen && picked === null && focusedArea !== null);

  // 瓦片和边界 SVG 的视野（共用 mapCamera.ts，算法照旧）
  const tileImgs = tileImages(tiles, cam, size, toScreen(0, 0));
  const shapesBox = shapesViewBox(cam, size);

  // 图例里关掉的地点不画；选中的那个照样画，免得路线卡指着一个看不见的点。
  // 信噪比分级：未访问过的非地铁站 ft: 数据终端归入「数据终端」开关，且放大到 POI_ZOOM 以上才铺出来；
  // 核心地点、已去过的地点、NCART 地铁站和当前选中目标常驻「地点」层，保持低倍全城总览清爽。
  const visibleDests = destinations.filter((d) => {
    if (d.id === picked) return true;
    if (d.here) return !hidden.has("here");
    if (d.firstVisit) {
      if (d.layer !== "ft") return false;
      if (d.metro) return !hidden.has("dest");
      return !hidden.has("terminals") && zoom >= POI_ZOOM;
    }
    return !hidden.has("dest");
  });
  const firstVisits = new Map(destinations.filter((d) => d.firstVisit).map((d) => [d.id, d]));
  const terminalCount = destinations.filter((d) => isUnvisitedTerminal(d)).length;

  // 路线连线：选中非当前位置的目标且当前位置在地图上时，在底图与图钉之间画一条战术虚线
  const routeLine =
    size.w > 0 && here && dest && !dest.here
      ? { from: toScreen(here.x, here.y), to: toScreen(dest.x, dest.y) }
      : null;

  // 地点名字：当前位置和选中的先摆，右边放不下放左边，再放不下就只在悬停时显示
  const sides = new Map<string, "right" | "left" | "hidden">();
  {
    const boxes: Box[] = [];
    const order = [...visibleDests].sort(
      (a, b) =>
        Number(b.here) - Number(a.here) || Number(b.id === picked) - Number(a.id === picked),
    );
    for (const d of order) {
      const at = toScreen(d.x, d.y);
      const w = d.name.length * 13 + 12;
      const right: Box = { x0: at.left + 10, y0: at.top - 9, x1: at.left + 10 + w, y1: at.top + 9 };
      const left: Box = { x0: at.left - 10 - w, y0: at.top - 9, x1: at.left - 10, y1: at.top + 9 };
      if (!overlaps(right, boxes)) {
        boxes.push(right);
        sides.set(d.id, "right");
      } else if (!overlaps(left, boxes)) {
        boxes.push(left);
        sides.set(d.id, "left");
      } else {
        sides.set(d.id, "hidden");
      }
    }
  }

  // 服务点：1 倍就显示，不再等放大（用户 2026-11-02 选的"降低门槛"）；挤在一起的只留第一个，避免糊成一片；
  // 图例里关掉的类别不占位置
  const pois: { readonly poi: MapPoi; readonly style: CSSProperties; extra: number }[] = [];
  {
    const cellEntry = new Map<string, (typeof pois)[number]>();
    // 已经去过、记下的原作店作为目的地图钉画，装饰图标不再重复画
    const booked = new Set(destinations.filter((d) => !d.firstVisit).map((d) => d.id));
    for (const poi of MAP_POIS) {
      // 选中的第一次去的店已经当图钉画了
      if (hidden.has(poi.kind) || booked.has(`poi:${poi.id}`) || picked === `poi:${poi.id}`)
        continue;
      const at = toScreen(poi.x, poi.y);
      if (!onScreen(at)) continue;
      const cell = `${Math.round(at.left / 24)}:${Math.round(at.top / 24)}`;
      const existing = cellEntry.get(cell);
      if (existing) {
        existing.extra += 1;
        continue;
      }
      const style = iconStyle(poiIcon(poi.kind), at);
      if (!style) continue;
      const entry = { poi, style, extra: 0 };
      cellEntry.set(cell, entry);
      pois.push(entry);
    }
  }

  const policeLegend = iconStyle(POLICE_ICON);
  const homeLegend = iconStyle(HOME_ICON);
  const vehicleLegend = iconStyle(VEHICLE_ICON);

  // 图例即筛选：每项一个开关，后面标地图上有几个
  const legend: {
    readonly key: LegendKey;
    readonly name: string;
    readonly icon: ReactNode;
    readonly count: number | null;
  }[] = [
    { key: "here", name: "当前位置", icon: <i className={styles.legendHere} />, count: null },
    {
      key: "dest",
      name: "地点",
      icon: <i className={styles.legendDest} />,
      count: destinations.filter((d) => !d.here && (!d.firstVisit || (d.layer === "ft" && d.metro)))
        .length,
    },
    {
      key: "terminals",
      name: "数据终端",
      icon: <i className={styles.legendTerminal} />,
      count: terminalCount,
    },
  ];
  if (homeLegend) {
    legend.push({
      key: "homes",
      name: "住处",
      icon: (
        <span className={styles.mapPoi} data-kind="apartment" data-legend="" style={homeLegend} />
      ),
      count: [...homesAt.values()].reduce((n, list) => n + list.length, 0),
    });
  }
  if (vehicleLegend) {
    legend.push({
      key: "vehicles",
      name: "停放载具",
      icon: (
        <span className={styles.mapPoi} data-kind="vehicle" data-legend="" style={vehicleLegend} />
      ),
      count: [...vehiclesAt.values()].reduce((n, list) => n + list.length, 0),
    });
  }
  const jobLegend = iconStyle(JOB_ICON);
  if (jobLegend) {
    legend.push({
      key: "jobs",
      name: "委托地点",
      icon: <span className={styles.mapPoi} data-kind="quest" data-legend="" style={jobLegend} />,
      // 只数地图上标得出来的：地点对不上的委托不算
      count: [...jobsAt.values()].reduce((n, list) => n + list.length, 0),
    });
  }
  legend.push({
    key: "npcs",
    name: "人物",
    icon: <i className={styles.legendNpc} />,
    // 只数地图上标得出来的：地点对不上的人不算
    count: [...npcsAt.values()].reduce((n, list) => n + list.length, 0),
  });
  if (policeLegend) {
    legend.push({
      key: "police",
      name: "NCPD 警情",
      icon: (
        <span className={styles.mapPoi} data-kind="police" data-legend="" style={policeLegend} />
      ),
      count: view.ncpd.alerts.filter((a) => a.x !== null && a.y !== null).length,
    });
  }
  for (const k of MAP_POI_KINDS) {
    const style = iconStyle(poiIcon(k.id));
    if (!style) continue;
    legend.push({
      key: k.id,
      name: k.name,
      icon: <span className={styles.mapPoi} data-kind={k.id} data-legend="" style={style} />,
      count: POI_COUNT.get(k.id) ?? 0,
    });
  }
  const hiddenCount = legend.filter((l) => hidden.has(l.key)).length;
  const coreLegend = legend.filter((l) => !MAP_POI_KINDS.some((k) => k.id === l.key));
  const poiLegend = legend.filter((l) => MAP_POI_KINDS.some((k) => k.id === l.key));
  const isTacticalPreset = legend.every((l) =>
    CORE_LEGEND_KEYS.has(l.key) ? !hidden.has(l.key) : hidden.has(l.key),
  );
  const applyTacticalPreset = () =>
    setHidden(new Set(legend.filter((l) => !CORE_LEGEND_KEYS.has(l.key)).map((l) => l.key)));
  const quickestMinutes =
    dest && !dest.here
      ? dest.routes
          .filter((r) => r.blocked === undefined)
          .reduce<number | null>(
            (min, r) => (min === null || r.minutes < min ? r.minutes : min),
            null,
          )
      : null;
  const activeSector: Hover | null =
    hover ??
    (focusedArea
      ? focusedArea.level === "district"
        ? { district: focusedArea.name, sub: null }
        : {
            district:
              DISTRICT_SHAPES.find(
                (d) => d.id === SUBDISTRICT_SHAPES.find((s) => s.id === focusedArea.id)?.district,
              )?.name ?? focusedArea.name,
            sub: focusedArea.name,
          }
      : null);
  const sectorFactions = activeSector
    ? turfFactions.filter((f) => f.turf.includes(activeSector.district))
    : [];
  const sectorContested = activeSector
    ? (view.factions.contested.find((c) => c.district === activeSector.district) ?? null)
    : null;

  return (
    <section aria-label="地图" className={styles.mapScreen} style={pinVars()}>
      <header className={styles.mapTop}>
        <div className={styles.mapTopBrand}>
          <span className={styles.mapTopKicker}>{"NC // TACTICAL MAP"}</span>
          <h2 className={styles.mapTopTitle}>夜之城</h2>
        </div>
        {here ? (
          <button
            type="button"
            className={styles.mapHereJump}
            title="点击居中并高亮当前位置"
            onClick={focusHere}
          >
            <span className={styles.mapHereJumpTag}>当前</span>
            <strong className={styles.mapHereJumpName}>{here.name}</strong>
            <span className={styles.mapHereJumpArea}>
              {here.sub ? `${here.district} · ${here.sub}` : here.district}
            </span>
          </button>
        ) : (
          <span className={styles.dim}>当前位置未在地图标定</span>
        )}
        <form
          className={styles.mapSearch}
          data-overlay=""
          onSubmit={(e) => {
            e.preventDefault();
            const chosen = searchResults[searchIdx] ?? searchResults[0];
            if (chosen) selectDestination(chosen);
          }}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) setSearchOpen(false);
          }}
        >
          <span className={styles.mapSearchBox}>
            <CellFrame />
            <span className={styles.mapSearchIcon} aria-hidden="true">
              /
            </span>
            <input
              type="search"
              className={styles.mapSearchInput}
              value={query}
              placeholder="搜索地名、街区、城区或快速跳转…"
              aria-label="搜索地图地点"
              onFocus={() => setSearchOpen(true)}
              onChange={(e) => {
                setQuery(e.target.value);
                setSearchIdx(0);
                setSearchOpen(true);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setSearchOpen(false);
                } else if (e.key === "ArrowDown" && searchResults.length > 0) {
                  e.preventDefault();
                  setSearchOpen(true);
                  setSearchIdx((i) => (i + 1) % searchResults.length);
                } else if (e.key === "ArrowUp" && searchResults.length > 0) {
                  e.preventDefault();
                  setSearchOpen(true);
                  setSearchIdx((i) => (i - 1 + searchResults.length) % searchResults.length);
                }
              }}
            />
            {query.length > 0 && (
              <button
                type="button"
                className={styles.mapSearchClear}
                aria-label="清空搜索"
                onClick={() => {
                  setQuery("");
                  setSearchIdx(0);
                }}
              >
                ×
              </button>
            )}
          </span>
          {searchOpen && (
            <section className={styles.mapSearchDrop} aria-label="地图检索与快速定位">
              {trimmedQuery.length > 0 ? (
                <ul className={styles.mapSearchResults} aria-label="搜索结果">
                  {searchResults.length > 0 ? (
                    searchResults.map((d, idx) => (
                      <li key={d.id}>
                        <button
                          type="button"
                          className={styles.mapSearchItem}
                          data-active={idx === searchIdx || undefined}
                          onMouseEnter={() => setSearchIdx(idx)}
                          onClick={() => selectDestination(d)}
                        >
                          <span className={styles.mapSearchItemRow}>
                            <b>{d.name}</b>
                            {d.here && (
                              <em className={styles.mapSearchBadge} data-tone="here">
                                当前
                              </em>
                            )}
                            {!d.here && d.metro && (
                              <em className={styles.mapSearchBadge} data-tone="metro">
                                NCART
                              </em>
                            )}
                            {!d.here && d.firstVisit && (
                              <em className={styles.mapSearchBadge} data-tone="dim">
                                未到访
                              </em>
                            )}
                          </span>
                          <small className={styles.dim}>
                            {d.sub ? `${d.district} · ${d.sub}` : d.district}
                          </small>
                        </button>
                      </li>
                    ))
                  ) : (
                    <li className={styles.mapSearchEmpty}>
                      没有找到匹配的地点，可尝试搜索城区名或商铺类型（如「义体医生」「武器」）
                    </li>
                  )}
                </ul>
              ) : (
                <div className={styles.mapQuickJump}>
                  {quickTargets.length > 0 && (
                    <div className={styles.mapQuickGroup}>
                      <span className={styles.mapQuickHead}>关键目标</span>
                      <ul className={styles.mapSearchResults}>
                        {quickTargets.map(({ dest: d, badge, tone }) => (
                          <li key={d.id}>
                            <button
                              type="button"
                              className={styles.mapSearchItem}
                              onClick={() => selectDestination(d)}
                            >
                              <span className={styles.mapSearchItemRow}>
                                <b>{d.name}</b>
                                <em className={styles.mapSearchBadge} data-tone={tone}>
                                  {badge}
                                </em>
                              </span>
                              <small className={styles.dim}>
                                {d.sub ? `${d.district} · ${d.sub}` : d.district}
                              </small>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className={styles.mapQuickGroup}>
                    <span className={styles.mapQuickHead}>城区速览</span>
                    <div className={styles.mapDistrictChips}>
                      {DISTRICT_SHAPES.map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          className={styles.mapDistrictChip}
                          onClick={() => focusDistrict(d)}
                        >
                          {d.name}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}
        </form>
        <div className={styles.mapTools}>
          <Button small pressed={shapes} onClick={() => setShapes((s) => !s)}>
            城区边界
          </Button>
          <span className={styles.mapZoom}>
            <Button small label="缩小" onClick={() => zoomBy(1 / 1.4)}>
              −
            </Button>
            <span className={styles.mapZoomVal}>{zoom.toFixed(1)}×</span>
            <Button small label="放大" onClick={() => zoomBy(1.4)}>
              ＋
            </Button>
            <Button
              small
              onClick={() => {
                setFocusedArea(null);
                reset();
              }}
            >
              复位
            </Button>
          </span>
          {/* 关闭键就放在顶栏这一排最右边，用同一种小按钮，不另开一块（用户定的，计划第十二节） */}
          {onClose && (
            <Button small label="关闭地图（M / Esc）" onClick={onClose}>
              关闭
            </Button>
          )}
        </div>
      </header>

      <div
        ref={viewport}
        className={styles.mapViewport}
        data-dragging={dragging || undefined}
        role="application"
        aria-label="地图：滚轮或加减号缩放，拖动或方向键平移"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: 地图要能用键盘平移和缩放
        tabIndex={0}
        onPointerDown={(e) => {
          if (onOverlay(e.target)) return;
          dragStart(e);
        }}
        onPointerMove={(e) => {
          if (dragMove(e)) return;
          // 不在拖动：看鼠标停在哪个城区，右上角显示这里的帮派
          if (e.pointerType === "touch" || onOverlay(e.target)) return;
          const p = pointAt(e.clientX, e.clientY);
          const next = p ? districtAt(p.x, p.y) : null;
          setHover((prev) =>
            prev?.district === next?.district && prev?.sub === next?.sub ? prev : next,
          );
        }}
        onPointerLeave={() => setHover(null)}
        onPointerUp={(e) => dragEnd(e)}
        onPointerCancel={(e) => dragEnd(e)}
        onKeyDown={(e) => {
          keyPan(e);
        }}
      >
        {size.w > 0 && (
          <>
            <div
              className={styles.mapWorld}
              style={{
                left: toScreen(0, 0).left,
                top: toScreen(0, 0).top,
                width: cam.k * 100,
                height: cam.k * 100,
              }}
            >
              {tiles ? null : info ? (
                <img src={info.url} alt="" className={styles.mapImage} draggable={false} />
              ) : (
                <MissingAsset id={MAP} />
              )}
              {tileImgs.map((t) => (
                <img
                  key={t.key}
                  src={t.src}
                  alt=""
                  className={styles.mapTile}
                  draggable={false}
                  decoding="async"
                  style={{ left: t.left, top: t.top, width: t.size, height: t.size }}
                />
              ))}
            </div>
            {/* 原作点阵底纹（计划第十二节第 9 条）：放在地图底图之上、边界和标记之下，不拦截拖动和点击 */}
            <span
              className={styles.mapGrid}
              style={{ backgroundImage: cssUrl("fx.grid") }}
              aria-hidden
            />
            {shapes && (
              <MapShapes
                labels={false}
                viewBox={shapesBox}
                active={
                  hover?.district ??
                  (focusedArea?.level === "district" ? focusedArea.name : undefined)
                }
                activeSub={focusedArea?.level === "sub" ? focusedArea.name : undefined}
              />
            )}

            {shapes &&
              zoom >= SUB_ZOOM &&
              SUBDISTRICT_SHAPES.map((s) => {
                const at = toScreen(s.label[0], s.label[1]);
                return onScreen(at) ? (
                  <span key={s.id} className={styles.mapName} data-level="sub" style={at}>
                    {s.name}
                  </span>
                ) : null;
              })}
            {DISTRICT_SHAPES.map((d) => {
              const at = toScreen(d.label[0], d.label[1]);
              return onScreen(at) ? (
                <span
                  key={d.id}
                  className={styles.mapName}
                  data-level="district"
                  data-faint={zoom >= SUB_ZOOM || undefined}
                  style={at}
                >
                  {d.name}
                </span>
              ) : null;
            })}

            {pois.map(({ poi, style, extra }) => {
              const sub = poi.sub ? SUB_NAME.get(poi.sub) : undefined;
              const label = `${KIND_NAME.get(poi.kind) ?? poi.kind}${sub ? ` · ${sub}` : ""}`;
              const extraNote = extra > 0 ? `（附近另有 ${extra} 处服务点，放大可逐个查看）` : "";
              const go = firstVisits.get(`poi:${poi.id}`);
              const iconVar = {
                "--icon": (style as Record<string, string>)["--icon"],
              } as CSSProperties;
              // 原作店第一次去：图标点了出路线卡，照常出行，到了才记下来；多个图标重叠时显示 +N 提示放大
              return (
                <span
                  key={poi.id}
                  className={styles.mapPoiWrap}
                  style={{ left: style.left, top: style.top }}
                >
                  {go ? (
                    <button
                      type="button"
                      className={styles.mapPoi}
                      data-kind={poi.kind}
                      data-go=""
                      style={iconVar}
                      title={`${go.name}（${label}，还没去过）${extraNote}`}
                      aria-label={`去${go.name}`}
                      onClick={() => setPicked(go.id)}
                    />
                  ) : (
                    <span
                      className={styles.mapPoi}
                      data-kind={poi.kind}
                      style={iconVar}
                      title={`${label}${extraNote}`}
                    />
                  )}
                  {extra > 0 && (
                    <span className={styles.mapPoiCluster} aria-hidden="true">
                      +{extra}
                    </span>
                  )}
                </span>
              );
            })}

            {routeLine && (
              <>
                <svg
                  className={styles.mapRouteLineSvg}
                  width={size.w}
                  height={size.h}
                  aria-hidden="true"
                >
                  <line
                    x1={routeLine.from.left}
                    y1={routeLine.from.top}
                    x2={routeLine.to.left}
                    y2={routeLine.to.top}
                    className={styles.mapRouteLineGlow}
                  />
                  <line
                    x1={routeLine.from.left}
                    y1={routeLine.from.top}
                    x2={routeLine.to.left}
                    y2={routeLine.to.top}
                    className={styles.mapRouteLine}
                  />
                </svg>
                {quickestMinutes !== null &&
                  Math.hypot(
                    routeLine.to.left - routeLine.from.left,
                    routeLine.to.top - routeLine.from.top,
                  ) >= 72 && (
                    <span
                      className={styles.mapRouteMid}
                      style={{
                        left: (routeLine.from.left + routeLine.to.left) / 2,
                        top: (routeLine.from.top + routeLine.to.top) / 2,
                      }}
                      aria-hidden="true"
                    >
                      最快 {formatMinutes(quickestMinutes)}
                    </span>
                  )}
              </>
            )}

            {focusedArea && onScreen(toScreen(focusedArea.x, focusedArea.y)) && (
              <div
                className={styles.mapAreaFocus}
                style={toScreen(focusedArea.x, focusedArea.y)}
                aria-hidden="true"
              >
                <span className={styles.mapAreaFocusRing} />
                <span className={styles.mapAreaFocusTag}>
                  {focusedArea.level === "sub" ? "街区" : "城区"} · {focusedArea.name}
                </span>
              </div>
            )}

            {visibleDests.map((d) => (
              <div
                key={d.id}
                className={styles.mapDest}
                data-here={d.here || undefined}
                data-picked={d.id === picked || undefined}
                data-layer={d.layer}
                data-terminal={isUnvisitedTerminal(d) || undefined}
                data-metro={d.metro || undefined}
                style={toScreen(d.x, d.y)}
              >
                {d.here && <span className={styles.mapHereTag}>当前位置</span>}
                {d.here && <span className={styles.mapHereBeacon} aria-hidden="true" />}
                {d.here && herePing > 0 && (
                  <span key={herePing} className={styles.mapHereBurst} aria-hidden="true" />
                )}
                {/* 原作 mappin 的 shadow2 / iconBlack：图标下垫一块黑影，压住底图 */}
                <i className={styles.mapPinShadow} aria-hidden="true" />
                <button
                  type="button"
                  className={styles.mapDestPin}
                  // 记下的原作店照原作图标画
                  style={d.kind ? iconStyle(poiIcon(d.kind as MapPoiKind)) : undefined}
                  title={destTitle(d)}
                  aria-label={d.name}
                  aria-pressed={d.id === picked}
                  onClick={() => {
                    setFocusedArea(null);
                    if (d.here) {
                      setPicked((cur) => (cur === d.id ? null : d.id));
                      focusHere();
                    } else {
                      setPicked(d.id);
                    }
                  }}
                />
                <span
                  className={styles.mapDestLabel}
                  data-side={
                    d.here
                      ? sides.get(d.id) === "left"
                        ? "left"
                        : "right"
                      : (sides.get(d.id) ?? "hidden")
                  }
                >
                  {d.name}
                </span>
              </div>
            ))}
          </>
        )}

        {/* 住处 / 安全屋标记：放在地点图钉左上方，点开直接拉出路线卡 */}
        {size.w > 0 &&
          !hidden.has("homes") &&
          [...homesAt.entries()].map(([id, list]) => {
            const d = destById.get(id);
            if (!d) return null;
            const at = toScreen(d.x, d.y);
            if (!onScreen(at)) return null;
            const style = iconStyle(HOME_ICON);
            if (!style) return null;
            const title = `住处：${list.map((h) => h.name).join("、")} · ${destTitle(d)}`;
            return (
              <div key={`home-${id}`} className={styles.mapHome} style={at}>
                <i className={styles.mapPoliceShadow} aria-hidden="true" />
                <button
                  type="button"
                  className={styles.mapHomePin}
                  style={style}
                  title={title}
                  aria-label={title}
                  aria-pressed={picked === id}
                  onClick={() => setPicked(id)}
                />
              </div>
            );
          })}

        {/* 停放载具标记：放在地点图钉正上方偏左，显示玩家名下停在这里的车 */}
        {size.w > 0 &&
          !hidden.has("vehicles") &&
          [...vehiclesAt.entries()].map(([id, list]) => {
            const d = destById.get(id);
            if (!d) return null;
            const at = toScreen(d.x, d.y);
            if (!onScreen(at)) return null;
            const style = iconStyle(VEHICLE_ICON);
            if (!style) return null;
            const title = `停放载具：${list
              .map((v) => `${v.name}（${v.conditionLabel}${v.stolen ? "·赃车" : ""}）`)
              .join("；")} · ${destTitle(d)}`;
            return (
              <div key={`vehicle-${id}`} className={styles.mapVehicle} style={at}>
                <i className={styles.mapPoliceShadow} aria-hidden="true" />
                <button
                  type="button"
                  className={styles.mapVehiclePin}
                  style={style}
                  title={title}
                  aria-label={title}
                  aria-pressed={picked === id}
                  onClick={() => setPicked(id)}
                />
              </div>
            );
          })}

        {/* 委托按地点合并为一个标记；点开仍走普通出行，不直接接单或传送 */}
        {size.w > 0 &&
          !hidden.has("jobs") &&
          [...jobsAt.entries()].map(([id, list]) => {
            const d = destinations.find((p) => p.id === id);
            if (!d) return null;
            const at = toScreen(d.x, d.y);
            if (!onScreen(at)) return null;
            const style = iconStyle(JOB_ICON);
            if (!style) return null;
            const title = `委托：${list.map((j) => `${j.title}（${j.statusLabel}）`).join("；")} · ${destTitle(d)}`;
            // 用户 2026-11-02 嫌"图标不显眼"：放大、染红，下面照地点图钉垫原作黑影
            return (
              <div key={id} className={styles.mapJob} style={at}>
                <i className={styles.mapPinShadow} aria-hidden="true" />
                <button
                  type="button"
                  className={styles.mapJobPin}
                  data-kind="quest"
                  data-job-location={id}
                  style={style}
                  title={title}
                  aria-label={title}
                  aria-pressed={picked === id}
                  onClick={() => setPicked(id)}
                />
              </div>
            );
          })}

        {/* 人物按地点合并为一个标记，标在地点图钉右上角，免得盖住委托标记；点开照常出路线卡，不传送 */}
        {size.w > 0 &&
          !hidden.has("npcs") &&
          [...npcsAt.entries()].map(([id, list]) => {
            const d = destinations.find((p) => p.id === id);
            if (!d) return null;
            const at = toScreen(d.x, d.y);
            if (!onScreen(at)) return null;
            const title = `人物：${list.map((n) => n.name).join("、")} · ${destTitle(d)}`;
            return (
              <button
                key={`npcs-${id}`}
                type="button"
                className={styles.mapNpc}
                data-npc-location={id}
                style={{ left: at.left + 12, top: at.top - 12 }}
                title={title}
                aria-label={title}
                aria-pressed={picked === id}
                onClick={() => setPicked(id)}
              >
                {list.length}
              </button>
            );
          })}

        {/* NCPD 警情：放在地点图钉右下方，点开直接拉出该地点的路线卡 */}
        {size.w > 0 &&
          !hidden.has("police") &&
          view.ncpd.alerts.map((a) => {
            if (a.x === null || a.y === null) return null;
            const at = toScreen(a.x, a.y);
            if (!onScreen(at)) return null;
            const style = iconStyle(POLICE_ICON);
            if (!style) return null;
            const title = `NCPD 警情：${a.label}（${a.locationName}，赏金 ${a.reward} 欧元，${a.until} 前）：${a.note}`;
            const hasDest = destinations.some((d) => d.id === a.location);
            return hasDest ? (
              <div key={a.id} className={styles.mapPolice} style={at}>
                <i className={styles.mapPoliceShadow} aria-hidden="true" />
                <button
                  type="button"
                  className={styles.mapPolicePin}
                  data-kind="police"
                  style={style}
                  title={title}
                  aria-label={title}
                  aria-pressed={picked === a.location}
                  onClick={() => setPicked(a.location)}
                />
              </div>
            ) : (
              <span
                key={a.id}
                className={styles.mapPoi}
                data-kind="police"
                style={{ ...style, ...at }}
                title={title}
              />
            );
          })}

        {/* 柔和暗角与四角战术取景刻度（纯装饰，不拦截交互） */}
        <span className={styles.mapVignette} aria-hidden="true" />
        <span className={styles.mapHudCorners} aria-hidden="true" />

        {/* 右上角城区卡：悬停或点击“城区速览”聚焦时展示，涵盖帮派、占据企业势力与火拼争夺态 */}
        {activeSector && !dest && (
          <section
            className={styles.mapDistrictCard}
            aria-label={`${activeSector.district}势力情报`}
          >
            <NineSlice
              id="map.shadowText"
              tint="#000"
              slice={TEXT_SHADOW_SLICE}
              className={styles.mapDistrictShadow}
            />
            <div className={styles.mapDistrictSurface}>
              <span className={styles.mapDistrictKicker}>SECTOR INTEL</span>
              <div className={styles.mapDistrictHead}>
                {/* 原作地区徽章自带颜色，有的没有透明底，不能当蒙版染色 */}
                <Asset id={districtIcon(activeSector.district)} height={44} />
                <div>
                  <h3 className={styles.mapTitle}>{activeSector.district}</h3>
                  {activeSector.sub && (
                    <span className={styles.mapDistrictSub}>{activeSector.sub}</span>
                  )}
                </div>
              </div>
              {sectorContested && (
                <p className={styles.mapContestedNote}>
                  地盘争夺中：{sectorContested.factionNames.join(" × ")}（{sectorContested.reason}）
                </p>
              )}
              <h4 className={styles.mapGangsLabel}>控制势力</h4>
              {sectorFactions.length > 0 ? (
                <ul className={styles.mapGangList}>
                  {sectorFactions.map((g) => {
                    const logo = GANG_LOGOS[g.id];
                    return (
                      <li key={g.id} className={styles.mapGang}>
                        {logo ? (
                          <Asset id={logo} height={34} width={34} />
                        ) : (
                          <span
                            className={styles.mapFactionBadge}
                            style={{ borderColor: g.color, color: g.color }}
                          >
                            {g.kindLabel}
                          </span>
                        )}
                        <span className={styles.mapGangText}>
                          <b style={{ color: g.color }}>{g.name}</b>
                          <small className={styles.dim}>
                            {g.attitudeLabel}
                            {g.turfNote ? ` · ${g.turfNote}` : ""}
                          </small>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className={styles.dim}>无固定势力常驻控制</p>
              )}
            </div>
          </section>
        )}

        {dest && (
          <section className={styles.mapRouteCard} data-overlay="" aria-label={`去${dest.name}`}>
            {/* 原作默认 tooltip 的三层：阴影、底、框（框不透明度 0.3）；贴图垫在外壳上，内容在里层滚动 */}
            <NineSlice
              id="map.shadowSmall"
              tint="var(--tip-shadow)"
              slice={SHADOW_SLICE}
              className={styles.mapTipShadow}
            />
            <NineSlice
              id="map.tooltipBg"
              tint="var(--tip-bg)"
              slice={TOOLTIP_SLICE}
              className={styles.mapTipBg}
            />
            <NineSlice
              id="map.tooltipFg"
              tint="var(--tip-frame)"
              slice={TOOLTIP_SLICE}
              className={styles.mapTipFrame}
            />
            <div className={styles.mapRouteBody}>
              <div className={styles.mapRouteHead}>
                <div className={styles.mapRouteHeadText}>
                  <span className={styles.mapRouteKicker}>
                    {dest.sub ? `${dest.district} // ${dest.sub}` : dest.district}
                  </span>
                  <h3 className={`${styles.mapTitle} ${styles.mapTipTitle}`}>{dest.name}</h3>
                  <div className={styles.mapRoutePills}>
                    {dest.here && (
                      <span className={styles.mapRoutePill} data-tone="here">
                        当前位置
                      </span>
                    )}
                    {dest.metro && (
                      <span className={styles.mapRoutePill} data-tone="metro">
                        NCART 站台
                      </span>
                    )}
                    {dest.firstVisit && (
                      <span className={styles.mapRoutePill} data-tone="dim">
                        未到访
                      </span>
                    )}
                  </div>
                </div>
                <Button small label="取消选中" onClick={() => setPicked(null)}>
                  ✕
                </Button>
              </div>
              {(destHomes.length > 0 ||
                destVehicles.length > 0 ||
                destJobs.length > 0 ||
                destAlerts.length > 0 ||
                destGigs.length > 0 ||
                destNpcs.length > 0) && (
                <ul className={styles.mapIntelList} aria-label="地点态势情报">
                  {destHomes.map((h) => (
                    <li key={`home-${h.id}`} className={styles.mapIntelItem} data-kind="home">
                      <span className={styles.mapIntelBadge}>住处</span>
                      <div className={styles.mapIntelText}>
                        <strong>{h.name}</strong>
                        <span>可休息与存取储物箱</span>
                      </div>
                    </li>
                  ))}
                  {destVehicles.map((v) => (
                    <li key={`veh-${v.id}`} className={styles.mapIntelItem} data-kind="vehicle">
                      <span className={styles.mapIntelBadge}>载具</span>
                      <div className={styles.mapIntelText}>
                        <strong>{v.name}</strong>
                        <span>{`${v.conditionLabel}${v.stolen ? " · 赃车" : ""}`}</span>
                      </div>
                    </li>
                  ))}
                  {destJobs.map((j) => (
                    <li
                      key={`job-${j.id}`}
                      className={styles.mapIntelItem}
                      data-kind="job"
                      data-overdue={j.overdue || undefined}
                    >
                      <span className={styles.mapIntelBadge}>委托</span>
                      <div className={styles.mapIntelText}>
                        <strong>{j.title}</strong>
                        <span>
                          {`${j.statusLabel} · ${j.reward.toLocaleString("en-US")} 欧元${j.due ? ` · ${j.due} 前` : ""}`}
                        </span>
                      </div>
                    </li>
                  ))}
                  {destAlerts.map((a) => (
                    <li key={`alert-${a.id}`} className={styles.mapIntelItem} data-kind="police">
                      <span className={styles.mapIntelBadge}>警情</span>
                      <div className={styles.mapIntelText}>
                        <strong>{a.label}</strong>
                        <span>
                          {`赏金 ${a.reward.toLocaleString("en-US")} 欧元 · ${a.until} 前 · ${a.note}`}
                        </span>
                      </div>
                    </li>
                  ))}
                  {destGigs.map((g) => (
                    <li key={`gig-${g.id}`} className={styles.mapIntelItem} data-kind="gig">
                      <span className={styles.mapIntelBadge}>风声</span>
                      <div className={styles.mapIntelText}>
                        <strong>{g.name}</strong>
                        <span>
                          {g.beaten
                            ? `听说${g.opponent}被人放倒之后，这阵子台上冷清了不少`
                            : `${g.note}${g.rematch ? `（听说${g.rematch}才重新凑局）` : ""}`}
                        </span>
                      </div>
                    </li>
                  ))}
                  {destNpcs.map((n) => (
                    <li key={`npc-${n.id}`} className={styles.mapIntelItem} data-kind="npc">
                      <span className={styles.mapIntelBadge}>人物</span>
                      <div className={styles.mapIntelText}>
                        <strong>
                          {n.name}
                          {n.here ? " · 在场" : ""}
                        </strong>
                        <span>{n.role}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {dest.routes.length > 0 && (
                <div className={styles.mapRouteSection}>
                  <span className={styles.mapRouteSectionHead}>出行方式</span>
                  <ul className={styles.routeList}>
                    {dest.routes.map((r) => {
                      const vehicle = view.travel.vehicles.find((v) => v.id === r.vehicle);
                      const art = vehicleArtOf(vehicle?.model);
                      const riskTone = riskToneOf(r.risk);
                      return (
                        <li key={r.vehicle ? `${r.mode}:${r.vehicle}` : r.mode}>
                          <button
                            type="button"
                            className={styles.routeOption}
                            data-vehicle-art={art ? true : undefined}
                            disabled={!onTravel || r.blocked !== undefined}
                            onClick={() => onTravel?.(dest, r)}
                          >
                            {/* 原作 tooltip 里没有逐行的框；借同一屏筛选开关（FiltersListItem）的 cell_bg 底、cell_fg 框 */}
                            <NineSlice
                              id="map.filterCellBg"
                              tint="var(--f-bg)"
                              slice={CELL_SLICE}
                              className={styles.mapFilterLayer}
                            />
                            <NineSlice
                              id="map.filterCellFg"
                              tint="var(--f-frame)"
                              slice={CELL_SLICE}
                              className={styles.mapFilterLayer}
                            />
                            <span className={styles.routeOptionDetails}>
                              <span className={styles.routeOptionTop}>
                                <b>{r.label}</b>
                                <span
                                  className={styles.routeCostBadge}
                                  data-free={r.cost === 0 || undefined}
                                >
                                  {r.cost > 0 ? `${r.cost} €$` : "免费"}
                                </span>
                              </span>
                              <span className={styles.routeMetaRow}>
                                <span className={styles.routeDuration}>
                                  约 {formatMinutes(r.minutes)} · 预计{" "}
                                  {formatEta(view.time.minutes, r.minutes)} 到
                                </span>
                                <span className={styles.routeRiskPill} data-risk={riskTone}>
                                  风险·{r.riskLabel}
                                </span>
                                {onTravel && r.blocked === undefined && (
                                  <span className={styles.routeGoArrow} aria-hidden="true">
                                    出发 →
                                  </span>
                                )}
                              </span>
                              {r.warnings && r.warnings.length > 0 && (
                                <span className={styles.routeWarnings}>
                                  {r.warnings.map((w) => (
                                    <small key={w} className={styles.routeWarning}>
                                      ⚠ {w}
                                    </small>
                                  ))}
                                </span>
                              )}
                              {r.blocked && (
                                <small className={styles.routeBlocked}>{r.blocked}</small>
                              )}
                            </span>
                            {art && <Asset id={art} className={styles.routeVehicleArt} />}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {dest.here && <p className={styles.dim}>你就在这里。</p>}
              {!onTravel && !dest.here && (
                <p className={styles.dim}>这一轮还没写完，写完再出发。</p>
              )}
            </div>
          </section>
        )}

        {/* 原作筛选列表没有底框；为了压住底图，借同一界面说明面板（FastTravelInstructions）的 cell_flip 底和框 */}
        <div className={styles.mapLegendBox} data-open={legendOpen || undefined} data-overlay="">
          <NineSlice
            id="map.panelBg"
            tint="var(--panel-bg)"
            slice={PANEL_SLICE}
            className={styles.mapPanelBg}
          />
          <NineSlice
            id="map.panelFg"
            tint="var(--panel-frame)"
            slice={PANEL_SLICE}
            className={styles.mapPanelFrame}
          />
          <div className={styles.mapLegendBody}>
            <button
              type="button"
              className={styles.mapLegendToggle}
              aria-expanded={legendOpen}
              onClick={() => setLegendOpen((open) => !open)}
            >
              <span className={styles.mapLegendTitle}>
                图层筛选
                {hiddenCount > 0 && (
                  <em className={styles.mapLegendCount}>{`已隐 ${hiddenCount}`}</em>
                )}
              </span>
              <span className={styles.mapLegendChevron} aria-hidden="true">
                {legendOpen ? "▾" : "▴"}
              </span>
            </button>
            {legendOpen && (
              <div className={styles.mapLegendDrawer}>
                {/* 原作世界地图的自定义筛选 + 本作新增「精简态势」一键预设 */}
                <div className={styles.mapFilterBar}>
                  <Button small disabled={hiddenCount === 0} onClick={() => setHidden(new Set())}>
                    全部显示
                  </Button>
                  <Button small pressed={isTacticalPreset} onClick={applyTacticalPreset}>
                    精简态势
                  </Button>
                  <Button
                    small
                    disabled={hiddenCount === legend.length}
                    onClick={() => setHidden(new Set(legend.map((l) => l.key)))}
                  >
                    全部隐藏
                  </Button>
                </div>
                <div className={styles.mapLegendGroup}>
                  <span className={styles.mapLegendGroupHead}>核心态势</span>
                  <ul className={styles.mapLegend}>
                    {coreLegend.map((l) => {
                      const on = !hidden.has(l.key);
                      return (
                        <li key={l.key}>
                          <button
                            type="button"
                            className={styles.mapFilter}
                            aria-pressed={on}
                            title={
                              l.key === "terminals"
                                ? on
                                  ? `在地图上隐藏${l.name}（放大至 ${POI_ZOOM}× 以上显示）`
                                  : `在地图上显示${l.name}（放大至 ${POI_ZOOM}× 以上显示）`
                                : on
                                  ? `在地图上隐藏${l.name}`
                                  : `在地图上显示${l.name}`
                            }
                            onClick={() => toggleLegend(l.key)}
                          >
                            <NineSlice
                              id="map.filterCellBg"
                              tint="var(--f-bg)"
                              slice={CELL_SLICE}
                              className={styles.mapFilterLayer}
                            />
                            <NineSlice
                              id="map.filterCellFg"
                              tint="var(--f-frame)"
                              slice={CELL_SLICE}
                              className={styles.mapFilterLayer}
                            />
                            <span className={styles.mapFilterBox} aria-hidden="true">
                              <NineSlice
                                id="map.filterBoxBg"
                                tint="var(--f-box-bg)"
                                slice={BOX_SLICE}
                                className={styles.mapFilterBoxBg}
                              />
                              <NineSlice
                                id="map.filterBoxFg"
                                tint="var(--f-box-frame)"
                                slice={BOX_SLICE}
                                className={styles.mapFilterLayer}
                              />
                              <NineSlice
                                id="map.filterBoxBg"
                                tint="var(--f-box)"
                                slice={BOX_SLICE}
                                className={styles.mapFilterBoxFill}
                              />
                            </span>
                            <span className={styles.mapFilterIcon} aria-hidden="true">
                              {l.icon}
                            </span>
                            <span className={styles.mapFilterName}>{l.name}</span>
                            {l.count !== null && (
                              <span className={styles.mapFilterCount}>{l.count}</span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
                {poiLegend.length > 0 && (
                  <div className={styles.mapLegendGroup}>
                    <span className={styles.mapLegendGroupHead}>商铺与设施</span>
                    <ul className={styles.mapLegend}>
                      {poiLegend.map((l) => {
                        const on = !hidden.has(l.key);
                        return (
                          <li key={l.key}>
                            <button
                              type="button"
                              className={styles.mapFilter}
                              aria-pressed={on}
                              title={on ? `在地图上隐藏${l.name}` : `在地图上显示${l.name}`}
                              onClick={() => toggleLegend(l.key)}
                            >
                              <NineSlice
                                id="map.filterCellBg"
                                tint="var(--f-bg)"
                                slice={CELL_SLICE}
                                className={styles.mapFilterLayer}
                              />
                              <NineSlice
                                id="map.filterCellFg"
                                tint="var(--f-frame)"
                                slice={CELL_SLICE}
                                className={styles.mapFilterLayer}
                              />
                              <span className={styles.mapFilterBox} aria-hidden="true">
                                <NineSlice
                                  id="map.filterBoxBg"
                                  tint="var(--f-box-bg)"
                                  slice={BOX_SLICE}
                                  className={styles.mapFilterBoxBg}
                                />
                                <NineSlice
                                  id="map.filterBoxFg"
                                  tint="var(--f-box-frame)"
                                  slice={BOX_SLICE}
                                  className={styles.mapFilterLayer}
                                />
                                <NineSlice
                                  id="map.filterBoxBg"
                                  tint="var(--f-box)"
                                  slice={BOX_SLICE}
                                  className={styles.mapFilterBoxFill}
                                />
                              </span>
                              <span className={styles.mapFilterIcon} aria-hidden="true">
                                {l.icon}
                              </span>
                              <span className={styles.mapFilterName}>{l.name}</span>
                              {l.count !== null && (
                                <span className={styles.mapFilterCount}>{l.count}</span>
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <p className={styles.mapStatusBar}>
          <span>滚轮缩放 · 拖拽平移 · Esc 取消</span>
          <span className={styles.mapStatusSep} aria-hidden="true">
            /
          </span>
          <span>底图和图标取自原作</span>
        </p>
      </div>
    </section>
  );
}
