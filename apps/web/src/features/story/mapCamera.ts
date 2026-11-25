import type { MapPoiKind } from "@cp/content/mapShapes";
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { type AssetId, asset, loadedMapTiles, loadMapTiles, type MapTiles } from "../../assets";
import { cssUrl } from "../../ui/Asset";

/**
 * 地图的视角、瓦片和图标：剧情地图（MapPanel）和捏人第 7 步选开局地点的地图共用。
 * 从 MapPanel 原样抽出来（2026-10-30，开局地点用户定的"在地图上选择"），算法不改，剧情地图行为照旧
 */

/** 视角：中心点（底图百分比）和缩放（每 1% 底图占多少屏幕像素） */
export interface Camera {
  readonly k: number;
  readonly cx: number;
  readonly cy: number;
}

/** 默认视角尽量框住城区和狗镇；底图至少铺满视野，所以宽屏时上下会裁掉一些 */
export const CITY = { x0: 4, x1: 72, y0: 2, y1: 96 } as const;
/** 放大到默认的几倍以后显示街区名和服务点 */
export const SUB_ZOOM = 1.35;
export const POI_ZOOM = 1.6;
/** 跳转到单个地点或玩家当前位置时的放大倍率，保证看清道路、周边标记与目标位置 */
export const FOCUS_ZOOM = 4.0;
/** 跳转到街区 / 城区区域时的放大倍率 */
export const SUB_AREA_ZOOM = 3.0;
export const DISTRICT_AREA_ZOOM = 2.2;
export const MAX_ZOOM = 8;

/** 底图整图：瓦片没生成或还没载入时垫在下面，正方形 */
export const MAP: AssetId = "map.roads";

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** 服务点图标：原作 mappin_icons 图集里的同类标记 */
export function poiIcon(kind: MapPoiKind): AssetId {
  return `map.poi.${kind}` as const;
}

/** 图标用遮罩上色：返回带 --icon 的样式；图集里没有这张图时返回 undefined（缺图列表会报出来） */
export function iconStyle(
  id: AssetId,
  at?: { left: number; top: number },
): CSSProperties | undefined {
  const info = asset(id);
  if (!info) return undefined;
  return { ...at, "--icon": `url("${info.url}")` } as CSSProperties;
}

/**
 * 地点标记照原作世界地图的 mappin（fullscreen/world_map/mappins）：
 * 目的地是 default_mappin 的 mappin_icons 图标垫 shadowBlobSquare_big 黑影；
 * 当前位置是 player_mappin 的 atlas_minimap player 箭头和 braindance_icons recording1 圆圈。
 * 都当遮罩用、CSS 上色，挂在地图根节点上，图例也能用；缺图时变量为空（缺图列表会报出来）
 */
export function pinVars(): CSSProperties {
  return {
    "--pin-dest": cssUrl("map.pinDest"),
    "--pin-shadow": cssUrl("map.pinShadow"),
    "--pin-player": cssUrl("map.pinPlayer"),
    "--pin-ping": cssUrl("map.pinPing"),
  } as CSSProperties;
}

/** 底图不能缩到比视野小，也不能拖出边：四边都不露黑 */
export function limit(c: Camera, w: number, h: number, kMax: number): Camera {
  if (w === 0 || h === 0) return c;
  const kMin = Math.max(w, h) / 100;
  const k = clamp(c.k, kMin, Math.max(kMin, kMax));
  const hw = w / (2 * k);
  const hh = h / (2 * k);
  return { k, cx: clamp(c.cx, hw, 100 - hw), cy: clamp(c.cy, hh, 100 - hh) };
}

export function fit(w: number, h: number): Camera {
  const cx = (CITY.x0 + CITY.x1) / 2;
  const cy = (CITY.y0 + CITY.y1) / 2;
  if (w === 0 || h === 0) return { k: 0, cx, cy };
  const k = Math.max(
    Math.min(w / (CITY.x1 - CITY.x0), h / (CITY.y1 - CITY.y0)),
    Math.max(w, h) / 100,
  );
  return limit({ k, cx, cy }, w, h, k);
}

/** 浮在地图上的卡片和图例：在上面点击、滚轮不拖动也不缩放地图 */
export function onOverlay(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("button, summary, [data-overlay]") !== null;
}

export interface TileImg {
  readonly key: string;
  readonly src: string;
  readonly left: number;
  readonly top: number;
  readonly size: number;
}

/**
 * 瓦片：挑一级让瓦片像素不少于屏幕物理像素，只摆视野里的几块；
 * 下面垫低两级的几块，换级时新瓦片没载完也不露底（不再垫整张底图：放大后它会被拉成上万像素）。
 * origin 是底图左上角在屏幕上的位置
 */
export function tileImages(
  tiles: MapTiles | null,
  cam: Camera,
  size: { readonly w: number; readonly h: number },
  origin: { readonly left: number; readonly top: number },
): TileImg[] {
  const out: TileImg[] = [];
  if (!tiles || size.w === 0) return out;
  const worldPx = cam.k * 100;
  const dpr = window.devicePixelRatio || 1;
  const top = clamp(Math.ceil(Math.log2((worldPx * dpr) / tiles.tile)), 0, tiles.maxZoom);
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
        out.push({
          key: `${z}/${x}/${y}`,
          src: tiles.url(z, x, y),
          left: x * ts,
          top: y * ts,
          size: ts + 0.5,
        });
      }
    }
  }
  return out;
}

/**
 * 边界 SVG 只画视野这一块。视野还没量出宽高（有一边是 0，fit 给的 k 是 0）时退回整张底图，
 * 不然除以 0 得到 "-Infinity NaN Infinity NaN"，React 会报 viewBox 错（2026-10-30 浏览器走查：改窗口宽度时出现）
 */
export function shapesViewBox(cam: Camera, size: { readonly w: number; readonly h: number }) {
  if (!(cam.k > 0) || size.w === 0 || size.h === 0) return "0 0 100 100";
  return `${cam.cx - size.w / (2 * cam.k)} ${cam.cy - size.h / (2 * cam.k)} ${size.w / cam.k} ${size.h / cam.k}`;
}

/** 载入瓦片清单；没生成瓦片时一直是 null，调用方垫整张底图；预载完成后首帧直接命中缓存 */
export function useMapTiles(): MapTiles | null {
  const [tiles, setTiles] = useState<MapTiles | null>(() => loadedMapTiles());
  useEffect(() => {
    if (tiles) return;
    let live = true;
    void loadMapTiles().then((t) => {
      if (live) setTiles(t);
    });
    return () => {
      live = false;
    };
  }, [tiles]);
  return tiles;
}

/** 视角：滚轮缩放、拖动平移、键盘。viewport 挂到地图视野那个元素上 */
export function useMapCamera() {
  const viewport = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [camera, setCamera] = useState<Camera | null>(null);
  const drag = useRef<{ x: number; y: number; id: number } | null>(null);
  /** 活跃触控点，用于双指捏合缩放 */
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchDist = useRef<number | null>(null);
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

  // 滚轮要能阻止页面滚动，React 的 onWheel 是被动监听，所以手动挂；在浮层上滚动时不缩放
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

  /** 底图百分比换屏幕坐标（相对视野左上角） */
  const toScreen = (x: number, y: number) => ({
    left: (x - cam.cx) * cam.k + size.w / 2,
    top: (y - cam.cy) * cam.k + size.h / 2,
  });
  const onScreen = (p: { left: number; top: number }) =>
    p.left > -120 && p.left < size.w + 120 && p.top > -40 && p.top < size.h + 40;

  /** 屏幕坐标（clientX/Y）换回底图百分比，不取整、不夹边；视野还没量出大小时为 null */
  const pointAt = (clientX: number, clientY: number) => {
    const r = viewport.current?.getBoundingClientRect();
    if (!r || cam.k === 0) return null;
    return {
      x: cam.cx + (clientX - r.left - size.w / 2) / cam.k,
      y: cam.cy + (clientY - r.top - size.h / 2) / cam.k,
    };
  };

  const zoomBy = (factor: number) => zoomAt(factor, size.w / 2, size.h / 2);
  const reset = () => setCamera(null);

  /** 把 (x, y) 挪到视野中间，缩放不低于默认的 minZoom 倍（选点地图从列表里挑地点时用） */
  const lookAt = (x: number, y: number, minZoom = 1) => {
    const { w, h } = size;
    if (w === 0 || h === 0) return;
    const base = fit(w, h);
    const kMax = base.k * MAX_ZOOM;
    setCamera((prev) => {
      const c = prev ? limit(prev, w, h, kMax) : base;
      return limit({ k: Math.max(c.k, base.k * minZoom), cx: x, cy: y }, w, h, kMax);
    });
  };

  /** 拖动平移 / 双指捏合缩放：按下。浮层上的按下由调用方先用 onOverlay 拦掉 */
  const dragStart = (e: ReactPointerEvent<HTMLElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // 某些触控/模拟事件不支持指针捕获，忽略即可
    }
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [
        { x: number; y: number },
        { x: number; y: number },
      ];
      pinchDist.current = Math.hypot(a.x - b.x, a.y - b.y);
      drag.current = null;
      setDragging(true);
      return;
    }
    if (pointers.current.size === 1) {
      pinchDist.current = null;
      drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
      setDragging(true);
    }
  };
  /** 拖动或捏合中返回 true 并更新视角；没在拖时返回 false，调用方自己处理悬停 */
  const dragMove = (e: ReactPointerEvent<HTMLElement>): boolean => {
    if (pointers.current.has(e.pointerId)) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()] as [
        { x: number; y: number },
        { x: number; y: number },
      ];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const prev = pinchDist.current;
      pinchDist.current = dist;
      if (prev && prev > 0 && dist > 0) {
        const r = viewport.current?.getBoundingClientRect();
        if (r) {
          const midX = (a.x + b.x) / 2 - r.left;
          const midY = (a.y + b.y) / 2 - r.top;
          zoomAt(dist / prev, midX, midY);
        }
      }
      return true;
    }
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return false;
    drag.current = { ...d, x: e.clientX, y: e.clientY };
    pan(e.clientX - d.x, e.clientY - d.y);
    return true;
  };
  const dragEnd = (e?: ReactPointerEvent<HTMLElement>) => {
    if (e) {
      pointers.current.delete(e.pointerId);
    } else {
      pointers.current.clear();
    }
    pinchDist.current = null;
    if (pointers.current.size === 1) {
      const [remainingId, pos] = [...pointers.current.entries()][0] as [
        number,
        { x: number; y: number },
      ];
      drag.current = { id: remainingId, x: pos.x, y: pos.y };
      setDragging(true);
      return;
    }
    drag.current = null;
    setDragging(false);
  };

  /** 键盘：加减号缩放、0 复位、方向键平移；处理了返回 true */
  const keyPan = (e: ReactKeyboardEvent<HTMLElement>): boolean => {
    const step = 80;
    if (e.key === "+" || e.key === "=") zoomBy(1.25);
    else if (e.key === "-" || e.key === "_") zoomBy(0.8);
    else if (e.key === "0") reset();
    else if (e.key === "ArrowLeft") pan(step, 0);
    else if (e.key === "ArrowRight") pan(-step, 0);
    else if (e.key === "ArrowUp") pan(0, step);
    else if (e.key === "ArrowDown") pan(0, -step);
    else return false;
    e.preventDefault();
    return true;
  };

  return {
    viewport,
    size,
    cam,
    zoom,
    dragging,
    zoomAt,
    pan,
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
  };
}
