import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type AssetId, asset, loadMapTiles, type MapTiles } from "../../assets";
import { MissingAsset } from "../../ui/Asset";
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
import type { View } from "./view";

export type MapDestination = View["travel"]["destinations"][number];
export type MapRoute = MapDestination["routes"][number];

/** 底图整图：瓦片没生成或还没载入时垫在下面，正方形 */
const MAP: AssetId = "map.roads";
/** NCPD 警情用原作地图上的悬赏标记 */
const POLICE_ICON: AssetId = "map.poi.police";

/** 城区和街区的边界：底图上叠一层 SVG，坐标是底图宽、高的百分比 */
export function MapShapes({ labels = true }: { readonly labels?: boolean }) {
  return (
    <>
      <svg
        className={styles.mapShapes}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {SUBDISTRICT_SHAPES.map((s) => (
          <polygon key={s.id} points={s.points} className={styles.mapSubdistrict} />
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
  const [turf, setTurf] = useState(false);
  const [services, setServices] = useState(true);
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

  // 帮派地盘摆在城区名的位置（这时城区名不显示）；没有原作轮廓的城区（恶土等）取已上图地点的平均坐标
  const centers = useMemo(() => {
    const sums = new Map<string, { x: number; y: number; n: number }>();
    for (const d of destinations) {
      const s = sums.get(d.district) ?? { x: 0, y: 0, n: 0 };
      sums.set(d.district, { x: s.x + d.x, y: s.y + d.y, n: s.n + 1 });
    }
    return [...sums].map(([district, s]) => {
      const shape = DISTRICT_SHAPES.find((d) => d.name === district);
      return shape
        ? { district, x: shape.label[0], y: shape.label[1] }
        : { district, x: s.x / s.n, y: s.y / s.n };
    });
  }, [destinations]);

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

  // 瓦片：挑一级让瓦片像素不少于屏幕物理像素，只摆视野里的几块
  const tileImgs: { key: string; src: string; left: number; top: number; size: number }[] = [];
  if (tiles && size.w > 0) {
    const worldPx = cam.k * 100;
    const dpr = window.devicePixelRatio || 1;
    const z = clamp(Math.ceil(Math.log2((worldPx * dpr) / tiles.tile)), 0, tiles.maxZoom);
    const n = 2 ** z;
    const ts = worldPx / n;
    const origin = toScreen(0, 0);
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

  // 地点名字：当前位置和选中的先摆，右边放不下放左边，再放不下就只在悬停时显示
  const sides = new Map<string, "right" | "left" | "hidden">();
  {
    const boxes: Box[] = [];
    const order = [...destinations].sort(
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

  // 服务点：放大后才显示；挤在一起的只留第一个，避免糊成一片
  const pois: { readonly poi: MapPoi; readonly style: CSSProperties }[] = [];
  if (services && zoom >= POI_ZOOM) {
    const taken = new Set<string>();
    for (const poi of MAP_POIS) {
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
          <button
            type="button"
            className={styles.mapLayer}
            aria-pressed={services}
            onClick={() => setServices((s) => !s)}
          >
            服务点
          </button>
          <button
            type="button"
            className={styles.mapLayer}
            aria-pressed={turf}
            onClick={() => setTurf((t) => !t)}
          >
            帮派地盘
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
          if (!d || d.id !== e.pointerId) return;
          drag.current = { ...d, x: e.clientX, y: e.clientY };
          pan(e.clientX - d.x, e.clientY - d.y);
        }}
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
              {info ? (
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
                  style={{ left: t.left, top: t.top, width: t.size, height: t.size }}
                />
              ))}
              {shapes && <MapShapes labels={false} />}
            </div>

            {shapes &&
              !turf &&
              zoom >= SUB_ZOOM &&
              SUBDISTRICT_SHAPES.map((s) => {
                const at = toScreen(s.label[0], s.label[1]);
                return onScreen(at) ? (
                  <span key={s.id} className={styles.mapName} data-level="sub" style={at}>
                    {s.name}
                  </span>
                ) : null;
              })}
            {!turf &&
              DISTRICT_SHAPES.map((d) => {
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

            {turf &&
              centers.map((c) => {
                const owners = gangs.filter((g) => g.turf.includes(c.district));
                if (owners.length === 0) return null;
                return (
                  <div key={c.district} className={styles.turfTag} style={toScreen(c.x, c.y)}>
                    {owners.map((g) => (
                      <span key={g.id} className={styles.turfName} style={{ color: g.color }}>
                        {g.name}
                        {g.attitude === "neutral" ? "" : `·${g.attitudeLabel}`}
                      </span>
                    ))}
                  </div>
                );
              })}

            {view.ncpd.alerts.map((a) => {
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

            {destinations.map((d) => (
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

        {dest && (
          <section className={styles.mapRouteCard} data-overlay="" aria-label={`去${dest.name}`}>
            <div className={styles.mapRouteHead}>
              <div>
                <h3 className={styles.mapTitle}>{dest.name}</h3>
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
          </section>
        )}

        <details className={styles.mapLegendBox} data-overlay="" open>
          <summary>图例</summary>
          <ul className={styles.mapLegend}>
            <li>
              <i className={styles.legendHere} />
              当前位置
            </li>
            <li>
              <i className={styles.legendDest} />
              可以去的地点
            </li>
            {policeLegend && (
              <li>
                <span
                  className={styles.mapPoi}
                  data-kind="police"
                  data-legend=""
                  style={policeLegend}
                />
                NCPD 警情
              </li>
            )}
            {services &&
              MAP_POI_KINDS.map((k) => {
                const style = iconStyle(poiIcon(k.id));
                return style ? (
                  <li key={k.id}>
                    <span className={styles.mapPoi} data-kind={k.id} data-legend="" style={style} />
                    {k.name}
                  </li>
                ) : null;
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
