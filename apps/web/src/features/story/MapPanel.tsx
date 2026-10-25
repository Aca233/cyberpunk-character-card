import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type AssetId, asset } from "../../assets";
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

/** 底图：从原作世界地图的道路网格烘焙的俯视图，正方形 */
const MAP: AssetId = "map.roads";

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

/** 默认视角框住城区和狗镇，恶土只露出靠城的一截，和原作打开地图时差不多 */
const CITY = { x0: 4, x1: 72, y0: 2, y1: 96 } as const;
/** 放大到默认的几倍以后显示街区名和服务点 */
const SUB_ZOOM = 1.35;
const POI_ZOOM = 1.6;
const MAX_ZOOM = 8;

/** 服务点的图标：原作用图形图标，这里用一个字代替，名称见图例和悬停提示 */
const GLYPH: Record<MapPoiKind, string> = {
  fixer: "中",
  ripperdoc: "义",
  gun: "枪",
  melee: "刃",
  netrunner: "网",
  clothes: "衣",
  meds: "药",
  junk: "杂",
  food: "食",
  bar: "酒",
  apartment: "寓",
  rent: "租",
  autofixer: "车",
};
const KIND_NAME = new Map(MAP_POI_KINDS.map((k) => [k.id, k.name]));
const SUB_NAME = new Map(SUBDISTRICT_SHAPES.map((s) => [s.id, s.name]));

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function fit(w: number, h: number): Camera {
  const k = Math.min(w / (CITY.x1 - CITY.x0), h / (CITY.y1 - CITY.y0));
  return { k, cx: (CITY.x0 + CITY.x1) / 2, cy: (CITY.y0 + CITY.y1) / 2 };
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
  const destinations = view.travel.destinations;
  const here = destinations.find((d) => d.here);
  const dest = destinations.find((d) => d.id === picked);
  const info = asset(MAP);
  const gangs = view.factions.list.filter((f) => f.kind === "gang" && f.turf.length > 0);

  // 城区的位置：有原作轮廓的用轮廓中心，没有的（恶土等）取城区里已上图地点的平均坐标
  const centers = useMemo(() => {
    const sums = new Map<string, { x: number; y: number; n: number }>();
    for (const d of destinations) {
      const s = sums.get(d.district) ?? { x: 0, y: 0, n: 0 };
      sums.set(d.district, { x: s.x + d.x, y: s.y + d.y, n: s.n + 1 });
    }
    return [...sums].map(([district, s]) => {
      const shape = DISTRICT_SHAPES.find((d) => d.name === district);
      return shape
        ? { district, x: shape.label[0], y: shape.label[1] + 3 }
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
  const cam = camera ?? home;
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
      if (size.w === 0 || size.h === 0) return;
      setCamera((prev) => {
        const base = fit(size.w, size.h);
        const c = prev ?? base;
        const k = clamp(c.k * factor, Math.min(size.w, size.h) / 100, base.k * MAX_ZOOM);
        const px = c.cx + (mx - size.w / 2) / c.k;
        const py = c.cy + (my - size.h / 2) / c.k;
        return {
          k,
          cx: clamp(px - (mx - size.w / 2) / k, 0, 100),
          cy: clamp(py - (my - size.h / 2) / k, 0, 100),
        };
      });
    },
    [size.w, size.h],
  );

  const pan = useCallback(
    (dx: number, dy: number) => {
      if (size.w === 0 || size.h === 0) return;
      setCamera((prev) => {
        const c = prev ?? fit(size.w, size.h);
        return { k: c.k, cx: clamp(c.cx - dx / c.k, 0, 100), cy: clamp(c.cy - dy / c.k, 0, 100) };
      });
    },
    [size.w, size.h],
  );

  // 滚轮要能阻止页面滚动，React 的 onWheel 是被动监听，所以手动挂
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
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
  const pois: { readonly poi: MapPoi; readonly at: { left: number; top: number } }[] = [];
  if (services && zoom >= POI_ZOOM) {
    const taken = new Set<string>();
    for (const poi of MAP_POIS) {
      const at = toScreen(poi.x, poi.y);
      if (!onScreen(at)) continue;
      const cell = `${Math.round(at.left / 20)}:${Math.round(at.top / 20)}`;
      if (taken.has(cell)) continue;
      taken.add(cell);
      pois.push({ poi, at });
    }
  }

  const center = () => ({ x: size.w / 2, y: size.h / 2 });
  const zoomBy = (factor: number) => zoomAt(factor, center().x, center().y);

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
          if ((e.target as Element).closest("button")) return;
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
              {shapes && <MapShapes labels={false} />}
            </div>

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

            {pois.map(({ poi, at }) => {
              const sub = poi.sub ? SUB_NAME.get(poi.sub) : undefined;
              return (
                <span
                  key={poi.id}
                  className={styles.mapPoi}
                  data-kind={poi.kind}
                  style={at}
                  title={`${KIND_NAME.get(poi.kind) ?? poi.kind}${sub ? ` · ${sub}` : ""}`}
                >
                  {GLYPH[poi.kind]}
                </span>
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

            {view.ncpd.alerts.map((a) =>
              a.x === null || a.y === null ? null : (
                <span
                  key={a.id}
                  className={styles.alertPin}
                  style={toScreen(a.x, a.y)}
                  title={`NCPD 警情：${a.label}（${a.locationName}，赏金 ${a.reward} 欧元，${a.until} 前）`}
                >
                  !
                </span>
              ),
            )}

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
        <p className={styles.mapHint}>
          滚轮缩放 · 拖动平移 · 放大到 {POI_ZOOM}× 显示服务点 · 底图和边界取自原作世界地图
        </p>
      </div>

      <aside className={styles.mapSide}>
        {dest ? (
          <>
            <h3 className={styles.mapTitle}>{dest.name}</h3>
            <p className={styles.dim}>
              {dest.district}
              {dest.metro && " · 有 NCART 站台"}
            </p>
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
          </>
        ) : (
          <p className={styles.dim}>
            点地图上的黄色菱形看怎么去；耗时、路费和风险由代码算，确认后 AI
            接着写路上和到达。没标出来的地方用输入框写怎么去。
          </p>
        )}

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

        <h4 className={styles.mapSubtitle}>图例</h4>
        <ul className={styles.mapLegend}>
          <li>
            <i className={styles.legendHere} />
            当前位置
          </li>
          <li>
            <i className={styles.legendDest} />
            可以去的地点
          </li>
          <li>
            <i className={styles.legendAlert}>!</i>
            NCPD 警情
          </li>
          {services &&
            MAP_POI_KINDS.map((k) => (
              <li key={k.id}>
                <span className={styles.mapPoi} data-kind={k.id} data-legend="">
                  {GLYPH[k.id]}
                </span>
                {k.name}
              </li>
            ))}
        </ul>
      </aside>
    </div>
  );
}
