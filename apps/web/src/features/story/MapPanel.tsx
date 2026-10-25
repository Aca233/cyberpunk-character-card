import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { type AssetId, asset, loadMapTiles, type MapTiles } from "../../assets";
import { Asset, MissingAsset, NineSlice } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import {
  DISTRICT_SHAPES,
  MAP_POI_KINDS,
  MAP_POIS,
  type MapPoi,
  type MapPoiKind,
  SUBDISTRICT_SHAPES,
} from "./mapShapes.gen";
import styles from "./story.module.css";
import { districtIcon, type View } from "./view";

export type MapDestination = View["travel"]["destinations"][number];
export type MapRoute = MapDestination["routes"][number];

/** 底图整图：瓦片没生成或还没载入时垫在下面，正方形 */
const MAP: AssetId = "map.roads";
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
}: {
  readonly labels?: boolean;
  readonly viewBox?: string;
  /** 鼠标停着的城区（名字），整块提亮 */
  readonly active?: string | undefined;
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

/** 视角：中心点（底图百分比）和缩放（每 1% 底图占多少屏幕像素） */
interface Camera {
  readonly k: number;
  readonly cx: number;
  readonly cy: number;
}

/** 默认视角尽量框住城区和狗镇；底图至少铺满视野，所以宽屏时上下会裁掉一些 */
const CITY = { x0: 4, x1: 72, y0: 2, y1: 96 } as const;
/** 放大到默认的几倍以后显示街区名和服务点 */
const SUB_ZOOM = 1.35;
const POI_ZOOM = 1.6;
const MAX_ZOOM = 8;

/** 服务点图标：原作 mappin_icons 图集里的同类标记 */
function poiIcon(kind: MapPoiKind): AssetId {
  return `map.poi.${kind}` as const;
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

/** 图例每一项都能开关：当前位置、可以去的地点、NCPD 警情和每类服务点 */
type LegendKey = "here" | "dest" | "police" | MapPoiKind;
const LEGEND_KEYS = new Set<string>(["here", "dest", "police", ...MAP_POI_KINDS.map((k) => k.id)]);
/** 关掉的图例项记在浏览器里，下次打开地图照旧 */
const HIDDEN_STORE = "cp.mapHidden";

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

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** 图标用遮罩上色：返回带 --icon 的样式；图集里没有这张图时返回 undefined（缺图列表会报出来） */
function iconStyle(id: AssetId, at?: { left: number; top: number }): CSSProperties | undefined {
  const info = asset(id);
  if (!info) return undefined;
  return { ...at, "--icon": `url("${info.url}")` } as CSSProperties;
}

/** 底图不能缩到比视野小，也不能拖出边：四边都不露黑 */
function limit(c: Camera, w: number, h: number, kMax: number): Camera {
  if (w === 0 || h === 0) return c;
  const kMin = Math.max(w, h) / 100;
  const k = clamp(c.k, kMin, Math.max(kMin, kMax));
  const hw = w / (2 * k);
  const hh = h / (2 * k);
  return { k, cx: clamp(c.cx, hw, 100 - hw), cy: clamp(c.cy, hh, 100 - hh) };
}

function fit(w: number, h: number): Camera {
  const cx = (CITY.x0 + CITY.x1) / 2;
  const cy = (CITY.y0 + CITY.y1) / 2;
  if (w === 0 || h === 0) return { k: 0, cx, cy };
  const k = Math.max(
    Math.min(w / (CITY.x1 - CITY.x0), h / (CITY.y1 - CITY.y0)),
    Math.max(w, h) / 100,
  );
  return limit({ k, cx, cy }, w, h, k);
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

/** 浮在地图上的卡片和图例：在上面点击、滚轮不拖动也不缩放地图 */
function onOverlay(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("button, summary, [data-overlay]") !== null;
}

/** 地图和路线面板：全屏，滚轮缩放、拖动平移；耗时、路费和风险由代码按路线表算，不调用模型 */
export function MapPanel({
  view,
  onTravel,
  onClose,
}: {
  readonly view: View;
  /** 正在生成时不传，路线不能点 */
  readonly onTravel?: ((dest: MapDestination, route: MapRoute) => void) | undefined;
  readonly onClose: () => void;
}) {
  const [shapes, setShapes] = useState(true);
  const [hover, setHover] = useState<Hover | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<LegendKey>>(loadHidden);
  const [picked, setPicked] = useState<string | null>(null);
  const [tiles, setTiles] = useState<MapTiles | null>(null);
  const destinations = view.travel.destinations;
  const here = destinations.find((d) => d.here);
  const dest = destinations.find((d) => d.id === picked);
  const info = asset(MAP);
  const gangs = view.factions.list.filter((f) => f.kind === "gang" && f.turf.length > 0);

  useEffect(() => {
    let live = true;
    void loadMapTiles().then((t) => {
      if (live) setTiles(t);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(HIDDEN_STORE, JSON.stringify([...hidden]));
    } catch {
      // 存不下（隐私模式之类）就只在这次打开里有效
    }
  }, [hidden]);

  const toggleLegend = (key: LegendKey) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // ———— 视角：滚轮缩放、拖动平移、键盘 ————
  const viewport = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [camera, setCamera] = useState<Camera | null>(null);
  const drag = useRef<{ x: number; y: number; id: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const home = fit(size.w, size.h);
  const cam = camera ? limit(camera, size.w, size.h, home.k * MAX_ZOOM) : home;
  const zoom = home.k > 0 ? cam.k / home.k : 1;

  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /** 以屏幕上 (mx, my) 为不动点缩放 */
  const zoomAt = useCallback(
    (factor: number, mx: number, my: number) => {
      const { w, h } = size;
      if (w === 0 || h === 0) return;
      setCamera((prev) => {
        const base = fit(w, h);
        const kMax = base.k * MAX_ZOOM;
        const c = prev ? limit(prev, w, h, kMax) : base;
        const k = clamp(c.k * factor, Math.max(w, h) / 100, kMax);
        const px = c.cx + (mx - w / 2) / c.k;
        const py = c.cy + (my - h / 2) / c.k;
        return limit({ k, cx: px - (mx - w / 2) / k, cy: py - (my - h / 2) / k }, w, h, kMax);
      });
    },
    [size],
  );

  const pan = useCallback(
    (dx: number, dy: number) => {
      const { w, h } = size;
      if (w === 0 || h === 0) return;
      setCamera((prev) => {
        const base = fit(w, h);
        const kMax = base.k * MAX_ZOOM;
        const c = prev ? limit(prev, w, h, kMax) : base;
        return limit({ k: c.k, cx: c.cx - dx / c.k, cy: c.cy - dy / c.k }, w, h, kMax);
      });
    },
    [size],
  );

  // 滚轮要能阻止页面滚动，React 的 onWheel 是被动监听，所以手动挂；在图例和路线卡上滚动时不缩放
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.target instanceof Element && e.target.closest("[data-overlay]")) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  // 选中地点时 Esc 先取消选中，再按一次关掉地图
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (picked) setPicked(null);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picked, onClose]);

  const toScreen = (x: number, y: number) => ({
    left: (x - cam.cx) * cam.k + size.w / 2,
    top: (y - cam.cy) * cam.k + size.h / 2,
  });
  const onScreen = (p: { left: number; top: number }) =>
    p.left > -120 && p.left < size.w + 120 && p.top > -40 && p.top < size.h + 40;

  // 瓦片：挑一级让瓦片像素不少于屏幕物理像素，只摆视野里的几块；
  // 下面垫低两级的几块，换级时新瓦片没载完也不露底（不再垫整张底图：放大后它会被拉成上万像素）
  const tileImgs: { key: string; src: string; left: number; top: number; size: number }[] = [];
  if (tiles && size.w > 0) {
    const worldPx = cam.k * 100;
    const dpr = window.devicePixelRatio || 1;
    const top = clamp(Math.ceil(Math.log2((worldPx * dpr) / tiles.tile)), 0, tiles.maxZoom);
    const origin = toScreen(0, 0);
    const levels = top >= 2 ? [top - 2, top] : [top];
    for (const z of levels) {
      const n = 2 ** z;
      const ts = worldPx / n;
      const x0 = clamp(Math.floor(-origin.left / ts), 0, n - 1);
      const x1 = clamp(Math.floor((size.w - origin.left) / ts), 0, n - 1);
      const y0 = clamp(Math.floor(-origin.top / ts), 0, n - 1);
      const y1 = clamp(Math.floor((size.h - origin.top) / ts), 0, n - 1);
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          tileImgs.push({
            key: `${z}/${x}/${y}`,
            src: tiles.url(z, x, y),
            left: x * ts,
            top: y * ts,
            size: ts + 0.5,
          });
        }
      }
    }
  }
  // 边界 SVG 只画视野这一块
  const shapesBox = `${cam.cx - size.w / (2 * cam.k)} ${cam.cy - size.h / (2 * cam.k)} ${size.w / cam.k} ${size.h / cam.k}`;

  // 图例里关掉的地点不画；选中的那个照样画，免得路线卡指着一个看不见的点
  const visibleDests = destinations.filter(
    (d) => d.id === picked || !hidden.has(d.here ? "here" : "dest"),
  );

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

  // 服务点：放大后才显示；挤在一起的只留第一个，避免糊成一片；图例里关掉的类别不占位置
  const pois: { readonly poi: MapPoi; readonly style: CSSProperties }[] = [];
  if (zoom >= POI_ZOOM) {
    const taken = new Set<string>();
    for (const poi of MAP_POIS) {
      if (hidden.has(poi.kind)) continue;
      const at = toScreen(poi.x, poi.y);
      if (!onScreen(at)) continue;
      const cell = `${Math.round(at.left / 24)}:${Math.round(at.top / 24)}`;
      if (taken.has(cell)) continue;
      const style = iconStyle(poiIcon(poi.kind), at);
      if (!style) continue;
      taken.add(cell);
      pois.push({ poi, style });
    }
  }

  const center = () => ({ x: size.w / 2, y: size.h / 2 });
  const zoomBy = (factor: number) => zoomAt(factor, center().x, center().y);
  const policeLegend = iconStyle(POLICE_ICON);

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
      name: "可以去的地点",
      icon: <i className={styles.legendDest} />,
      count: destinations.filter((d) => !d.here).length,
    },
  ];
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
  const hoverGangs = hover ? gangs.filter((g) => g.turf.includes(hover.district)) : [];

  return (
    <div role="dialog" aria-label="地图" className={styles.mapScreen}>
      <header className={styles.mapTop}>
        <h2 className={styles.mapTopTitle}>夜之城</h2>
        <span className={styles.dim}>
          {here ? `当前位置：${here.name} · ${here.district}` : "现在的位置不在地图上"}
        </span>
        <div className={styles.mapTools}>
          <button
            type="button"
            className={styles.mapLayer}
            aria-pressed={shapes}
            onClick={() => setShapes((s) => !s)}
          >
            城区边界
          </button>
          <span className={styles.mapZoom}>
            <button
              type="button"
              className={styles.mapLayer}
              aria-label="缩小"
              onClick={() => zoomBy(1 / 1.4)}
            >
              −
            </button>
            <span className={styles.dim}>{zoom.toFixed(1)}×</span>
            <button
              type="button"
              className={styles.mapLayer}
              aria-label="放大"
              onClick={() => zoomBy(1.4)}
            >
              ＋
            </button>
            <button type="button" className={styles.mapLayer} onClick={() => setCamera(null)}>
              复位
            </button>
          </span>
          <Button onClick={onClose}>关闭</Button>
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
          drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragging(true);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) {
            // 不在拖动：看鼠标停在哪个城区，右上角显示这里的帮派
            if (e.pointerType === "touch" || onOverlay(e.target)) return;
            const r = e.currentTarget.getBoundingClientRect();
            const next = districtAt(
              cam.cx + (e.clientX - r.left - size.w / 2) / cam.k,
              cam.cy + (e.clientY - r.top - size.h / 2) / cam.k,
            );
            setHover((prev) =>
              prev?.district === next?.district && prev?.sub === next?.sub ? prev : next,
            );
            return;
          }
          drag.current = { ...d, x: e.clientX, y: e.clientY };
          pan(e.clientX - d.x, e.clientY - d.y);
        }}
        onPointerLeave={() => setHover(null)}
        onPointerUp={() => {
          drag.current = null;
          setDragging(false);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setDragging(false);
        }}
        onKeyDown={(e) => {
          const step = 80;
          if (e.key === "+" || e.key === "=") zoomBy(1.25);
          else if (e.key === "-" || e.key === "_") zoomBy(0.8);
          else if (e.key === "0") setCamera(null);
          else if (e.key === "ArrowLeft") pan(step, 0);
          else if (e.key === "ArrowRight") pan(-step, 0);
          else if (e.key === "ArrowUp") pan(0, step);
          else if (e.key === "ArrowDown") pan(0, -step);
          else return;
          e.preventDefault();
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
            {shapes && <MapShapes labels={false} viewBox={shapesBox} active={hover?.district} />}

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

            {pois.map(({ poi, style }) => {
              const sub = poi.sub ? SUB_NAME.get(poi.sub) : undefined;
              return (
                <span
                  key={poi.id}
                  className={styles.mapPoi}
                  data-kind={poi.kind}
                  style={style}
                  title={`${KIND_NAME.get(poi.kind) ?? poi.kind}${sub ? ` · ${sub}` : ""}`}
                />
              );
            })}

            {!hidden.has("police") &&
              view.ncpd.alerts.map((a) => {
                if (a.x === null || a.y === null) return null;
                const style = iconStyle(POLICE_ICON, toScreen(a.x, a.y));
                return style ? (
                  <span
                    key={a.id}
                    className={styles.mapPoi}
                    data-kind="police"
                    style={style}
                    title={`NCPD 警情：${a.label}（${a.locationName}，赏金 ${a.reward} 欧元，${a.until} 前）`}
                  />
                ) : null;
              })}

            {visibleDests.map((d) => (
              <div
                key={d.id}
                className={styles.mapDest}
                data-here={d.here || undefined}
                data-picked={d.id === picked || undefined}
                style={toScreen(d.x, d.y)}
              >
                {d.here && <span className={styles.mapHereTag}>当前位置</span>}
                <button
                  type="button"
                  className={styles.mapDestPin}
                  title={`${d.name} · ${d.district}${d.here ? "（当前位置）" : ""}`}
                  aria-label={d.name}
                  aria-pressed={d.id === picked}
                  onClick={() => setPicked(d.here ? null : d.id)}
                />
                <span className={styles.mapDestLabel} data-side={sides.get(d.id) ?? "hidden"}>
                  {d.name}
                </span>
              </div>
            ))}
          </>
        )}

        {/* 右上角城区卡：照原作世界地图的 districtInfo（城区图标、城区和街区名、主要帮派列表），不挡鼠标 */}
        {hover && (
          <section className={styles.mapDistrictCard} aria-label={`${hover.district}的帮派`}>
            <NineSlice
              id="map.shadowText"
              tint="#000"
              slice={TEXT_SHADOW_SLICE}
              className={styles.mapDistrictShadow}
            />
            <div className={styles.mapDistrictHead}>
              <Asset id={districtIcon(hover.district)} tint="var(--cp-yellow)" height={44} />
              <div>
                <h3 className={styles.mapTitle}>{hover.district}</h3>
                {hover.sub && <span className={styles.dim}>{hover.sub}</span>}
              </div>
            </div>
            {/* 原作 LocKey#77912 UI-Tooltips-LeadingGangs */}
            <h4 className={styles.mapGangsLabel}>主要帮派：</h4>
            {hoverGangs.length > 0 ? (
              <ul className={styles.mapGangList}>
                {hoverGangs.map((g) => {
                  const logo = GANG_LOGOS[g.id];
                  return (
                    <li key={g.id} className={styles.mapGang}>
                      {logo ? <Asset id={logo} height={36} width={36} /> : <i />}
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
              <p className={styles.dim}>没有帮派占着这里</p>
            )}
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
                <div>
                  <h3 className={`${styles.mapTitle} ${styles.mapTipTitle}`}>{dest.name}</h3>
                  <span className={styles.dim}>
                    {dest.district}
                    {dest.metro && " · 有 NCART 站台"}
                  </span>
                </div>
                <button
                  type="button"
                  className={styles.mapLayer}
                  aria-label="取消选中"
                  onClick={() => setPicked(null)}
                >
                  ✕
                </button>
              </div>
              <ul className={styles.routeList}>
                {dest.routes.map((r) => (
                  <li key={r.mode}>
                    <button
                      type="button"
                      className={styles.routeOption}
                      disabled={!onTravel || r.blocked !== undefined}
                      onClick={() => onTravel?.(dest, r)}
                    >
                      <b>{r.label}</b>
                      <span>
                        {r.minutes} 分钟 · {r.cost > 0 ? `${r.cost} 欧元` : "不花钱"} · 风险
                        {r.riskLabel}
                      </span>
                      {r.blocked && <small className={styles.dim}>{r.blocked}</small>}
                    </button>
                  </li>
                ))}
              </ul>
              {!onTravel && <p className={styles.dim}>这一轮还没写完，写完再出发。</p>}
              {view.travel.vehicles.length > 0 && (
                <>
                  <h4 className={styles.mapSubtitle}>名下的车</h4>
                  <ul className={styles.routeList}>
                    {view.travel.vehicles.map((v) => (
                      <li key={v.id}>
                        {v.name}
                        <span className={styles.dim}>
                          {" "}
                          · {v.classLabel} · {v.conditionLabel}
                          {v.stolen && " · 偷来的"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </section>
        )}

        <details className={styles.mapLegendBox} data-overlay="" open>
          <summary>
            图例
            {hiddenCount > 0 && <span className={styles.dim}>{` · 隐藏了 ${hiddenCount} 项`}</span>}
          </summary>
          {/* 原作世界地图的自定义筛选：「全部显示」是 UI-Menus-WorldMap-Filter-All，「全部隐藏」本作加的 */}
          <div className={styles.mapFilterBar}>
            <button
              type="button"
              className={styles.mapLayer}
              disabled={hiddenCount === 0}
              onClick={() => setHidden(new Set())}
            >
              全部显示
            </button>
            <button
              type="button"
              className={styles.mapLayer}
              disabled={hiddenCount === legend.length}
              onClick={() => setHidden(new Set(legend.map((l) => l.key)))}
            >
              全部隐藏
            </button>
          </div>
          <ul className={styles.mapLegend}>
            {legend.map((l) => {
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
                    {/* 原作 FiltersListItem：cell_bg 底、cell_fg 框；方框是 color_bg 底、color_fg 框、color_bg 填色 */}
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
                    {l.count !== null && <span className={styles.mapFilterCount}>{l.count}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </details>

        <p className={styles.mapHint}>
          {dest ? "" : "点黄色菱形看怎么去，没标出来的地方用输入框写 · "}
          滚轮缩放 · 拖动平移 · 放大到 {POI_ZOOM}× 显示服务点 · 底图和图标取自原作
        </p>
      </div>
    </div>
  );
}
