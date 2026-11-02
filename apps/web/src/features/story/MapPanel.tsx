import {
  DISTRICT_SHAPES,
  MAP_POI_KINDS,
  MAP_POIS,
  type MapPoi,
  type MapPoiKind,
  SUBDISTRICT_SHAPES,
} from "@cp/content/mapShapes";
import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import { type AssetId, asset } from "../../assets";
import { Asset, cssUrl, MissingAsset, NineSlice } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { useLayer } from "../../ui/layers";
// 视角、瓦片和图标抽到 mapCamera.ts，和捏人选开局地点的地图共用（2026-10-30，用户定的"在地图上选择"）
import {
  iconStyle,
  MAP,
  onOverlay,
  POI_ZOOM,
  pinVars,
  poiIcon,
  SUB_ZOOM,
  shapesViewBox,
  tileImages,
  useMapCamera,
  useMapTiles,
} from "./mapCamera";
import styles from "./story.module.css";
import { districtIcon, type View } from "./view";

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

/**
 * 图例每一项都能开关：当前位置、地点、委托、人物、NCPD 警情和每类服务点。
 * 地点统一一个开关，不按来源或是否去过分类；服务点分类不动（用户 2026-11-02："只把地点图钉统一"）。
 * 见过的人按现在在的地点画，中间人也一样
 */
type LegendKey = "here" | "dest" | "jobs" | "npcs" | "police" | MapPoiKind;
const LEGEND_KEYS = new Set<string>([
  "here",
  "dest",
  "jobs",
  "npcs",
  "police",
  ...MAP_POI_KINDS.map((k) => k.id),
]);
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
/** 原作 atlas_shapes_sync 的 cell_flip_bg / cell_flip_fg（左下斜角）切线：2160p 左/上/右/下 30/20/20/30，这里是 CSS 顺序 */
const PANEL_SLICE = [20, 20, 30, 30] as const;

/** 地点图钉的悬停说明：名字、城区，当前位置再标一下；不再按来源区分（用户 2026-11-02："只把地点图钉统一"） */
function destTitle(d: MapDestination): string {
  return `${d.name} · ${d.district}${d.here ? "（当前位置）" : ""}`;
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
  /** 打开时先选中的地点 id（正文里点了地名，第 3 条）：照常出路线卡，不传送；当前位置不选 */
  readonly focus?: string | undefined;
}) {
  const [shapes, setShapes] = useState(true);
  const [hover, setHover] = useState<Hover | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<LegendKey>>(loadHidden);
  const [picked, setPicked] = useState<string | null>(() =>
    focus !== undefined && view.travel.destinations.some((d) => d.id === focus && !d.here)
      ? focus
      : null,
  );
  const tiles = useMapTiles();
  const destinations = view.travel.destinations;
  const here = destinations.find((d) => d.here);
  const dest = destinations.find((d) => d.id === picked);
  // 委托地点（用户同意的 2026-10-30）：挂着和接下的委托，location 对得上目的地的 id 或名字才标；对不上不猜坐标
  const openJobs = view.jobs.list.filter((j) => j.open && j.location !== null);
  const jobsAt = new Map<string, (typeof openJobs)[number][]>();
  for (const j of openJobs) {
    const exact = destinations.find((x) => x.id === j.location);
    // 旧委托可能写的是名字；同名地点不止一个时不随便挑，避免把委托标到别处
    const named = exact ? [] : destinations.filter((x) => x.name === j.location);
    const d = exact ?? (named.length === 1 ? named[0] : undefined);
    if (d) jobsAt.set(d.id, [...(jobsAt.get(d.id) ?? []), j]);
  }
  const destJobs = dest ? (jobsAt.get(dest.id) ?? []) : [];
  // 人物（用户 2026-11-02："npc是能移动的"，中间人也是普通人物）：见过、活着的人按现在在的地点合并成一个标记；
  // 地点 id 对不上地图上的地点就不画，不猜坐标。在玩家眼前的人跟着当前位置走
  const npcsAt = new Map<string, View["npcs"][number][]>();
  for (const n of view.npcs) {
    if (!n.alive || n.placeId === null) continue;
    const d = destinations.find((x) => x.id === n.placeId);
    if (d) npcsAt.set(d.id, [...(npcsAt.get(d.id) ?? []), n]);
  }
  const destNpcs = dest ? (npcsAt.get(dest.id) ?? []) : [];
  const info = asset(MAP);
  const gangs = view.factions.list.filter((f) => f.kind === "gang" && f.turf.length > 0);

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

  // ———— 视角：滚轮缩放、拖动平移、键盘（共用 mapCamera.ts，算法照旧） ————
  const {
    viewport,
    size,
    cam,
    zoom,
    dragging,
    zoomBy,
    reset,
    toScreen,
    onScreen,
    pointAt,
    dragStart,
    dragMove,
    dragEnd,
    keyPan,
  } = useMapCamera();

  // 选中地点时 Esc 先取消选中；没选中时交给神经界面关闭
  useLayer(() => setPicked(null), picked !== null);

  // 瓦片和边界 SVG 的视野（共用 mapCamera.ts，算法照旧）
  const tileImgs = tileImages(tiles, cam, size, toScreen(0, 0));
  const shapesBox = shapesViewBox(cam, size);

  // 图例里关掉的地点不画；选中的那个照样画，免得路线卡指着一个看不见的点。
  // 第一次去的原作店不画图钉，留在原作图标那一层点（places-plan 第二期，用户定的 2026-10-30）；
  // 没去过的原作地标（数据终端、地铁站）放大到能看街区名时画图钉，点了照常出行、不传送（用户定的，2026-11-02）
  // 地标和其他地点共用「地点」开关，保留地标的缩放门槛，避免全城图钉挤在一起
  const visibleDests = destinations.filter(
    (d) =>
      d.id === picked ||
      (d.firstVisit
        ? d.layer === "ft" && zoom >= SUB_ZOOM && !hidden.has("dest")
        : !hidden.has(d.here ? "here" : "dest")),
  );
  const firstVisits = new Map(destinations.filter((d) => d.firstVisit).map((d) => [d.id, d]));

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
    // 已经去过、记下的原作店作为目的地图钉画，装饰图标不再重复画
    const booked = new Set(destinations.filter((d) => !d.firstVisit).map((d) => d.id));
    for (const poi of MAP_POIS) {
      // 选中的第一次去的店已经当图钉画了
      if (hidden.has(poi.kind) || booked.has(`poi:${poi.id}`) || picked === `poi:${poi.id}`)
        continue;
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
      name: "地点",
      icon: <i className={styles.legendDest} />,
      count: destinations.filter((d) => !d.here && (!d.firstVisit || d.layer === "ft")).length,
    },
  ];
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
  const hoverGangs = hover ? gangs.filter((g) => g.turf.includes(hover.district)) : [];

  return (
    <section aria-label="地图" className={styles.mapScreen} style={pinVars()}>
      <header className={styles.mapTop}>
        <h2 className={styles.mapTopTitle}>夜之城</h2>
        <span className={styles.dim}>
          {here ? `当前位置：${here.name} · ${here.district}` : "现在的位置不在地图上"}
        </span>
        <div className={styles.mapTools}>
          <Button small pressed={shapes} onClick={() => setShapes((s) => !s)}>
            城区边界
          </Button>
          <span className={styles.mapZoom}>
            <Button small label="缩小" onClick={() => zoomBy(1 / 1.4)}>
              −
            </Button>
            <span className={styles.dim}>{zoom.toFixed(1)}×</span>
            <Button small label="放大" onClick={() => zoomBy(1.4)}>
              ＋
            </Button>
            <Button small onClick={reset}>
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
        onPointerUp={dragEnd}
        onPointerCancel={dragEnd}
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
              const label = `${KIND_NAME.get(poi.kind) ?? poi.kind}${sub ? ` · ${sub}` : ""}`;
              const go = firstVisits.get(`poi:${poi.id}`);
              // 原作店第一次去：图标点了出路线卡，照常出行，到了才记下来
              return go ? (
                <button
                  key={poi.id}
                  type="button"
                  className={styles.mapPoi}
                  data-kind={poi.kind}
                  data-go=""
                  style={style}
                  title={`${go.name}（${label}，还没去过）`}
                  aria-label={`去${go.name}`}
                  onClick={() => setPicked(go.id)}
                />
              ) : (
                <span
                  key={poi.id}
                  className={styles.mapPoi}
                  data-kind={poi.kind}
                  style={style}
                  title={label}
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
                data-layer={d.layer}
                style={toScreen(d.x, d.y)}
              >
                {d.here && <span className={styles.mapHereTag}>当前位置</span>}
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
                  onClick={() => setPicked(d.here ? null : d.id)}
                />
                <span className={styles.mapDestLabel} data-side={sides.get(d.id) ?? "hidden"}>
                  {d.name}
                </span>
              </div>
            ))}
          </>
        )}

        {/* 委托按地点合并为一个标记；点开仍走普通出行，不直接接单或传送 */}
        {size.w > 0 &&
          !hidden.has("jobs") &&
          [...jobsAt.entries()].map(([id, list]) => {
            const d = destinations.find((p) => p.id === id);
            if (!d) return null;
            const at = toScreen(d.x, d.y);
            if (!onScreen(at)) return null;
            const style = iconStyle(JOB_ICON, at);
            if (!style) return null;
            const title = `委托：${list.map((j) => `${j.title}（${j.statusLabel}）`).join("；")} · ${destTitle(d)}`;
            return (
              <button
                key={id}
                type="button"
                className={`${styles.mapPoi} ${styles.mapJob}`}
                data-kind="quest"
                data-go=""
                data-job-location={id}
                style={style}
                title={title}
                aria-label={title}
                aria-pressed={picked === id}
                onClick={() => setPicked(id)}
              />
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
                onClick={() => setPicked(d.here ? null : id)}
              >
                {list.length}
              </button>
            );
          })}

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
              {/* 原作地区徽章自带颜色，有的没有透明底，不能当蒙版染色 */}
              <Asset id={districtIcon(hover.district)} height={44} />
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
                <Button small label="取消选中" onClick={() => setPicked(null)}>
                  ✕
                </Button>
              </div>
              {/* 这里挂着或接下的委托（用户同意的 2026-10-30）：只列名字、状态、星级和报酬，不在地图上接单 */}
              {destJobs.length > 0 && (
                <ul className={styles.jobs}>
                  {destJobs.map((j) => (
                    <li key={j.id} data-overdue={j.overdue || undefined}>
                      <strong>{j.title}</strong>
                      <span>
                        {`委托 · ${j.statusLabel} · ${j.risk} 星 · 报酬 ${j.reward} 欧元${j.due ? ` · ${j.due} 前` : ""}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {/* 这里现在有谁（用户 2026-11-02："npc是能移动的"）：只列名字和身份，见面照常靠剧情 */}
              {destNpcs.length > 0 && (
                <ul className={styles.jobs}>
                  {destNpcs.map((n) => (
                    <li key={n.id}>
                      <strong>{n.name}</strong>
                      <span>{`人物 · ${n.role}${n.here ? " · 就在你身边" : ""}`}</span>
                    </li>
                  ))}
                </ul>
              )}
              <ul className={styles.routeList}>
                {dest.routes.map((r) => (
                  <li key={r.mode}>
                    <button
                      type="button"
                      className={styles.routeOption}
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
              {dest.here && <p className={styles.dim}>你就在这里。</p>}
              {!onTravel && !dest.here && (
                <p className={styles.dim}>这一轮还没写完，写完再出发。</p>
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
            </div>
          </section>
        )}

        {/* 原作筛选列表没有底框；为了压住底图，借同一界面说明面板（FastTravelInstructions）的 cell_flip 底和框 */}
        <div className={styles.mapLegendBox} data-overlay="">
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
          <details className={styles.mapLegendBody} open>
            <summary>
              图例
              {hiddenCount > 0 && (
                <span className={styles.dim}>{` · 隐藏了 ${hiddenCount} 项`}</span>
              )}
            </summary>
            {/* 原作世界地图的自定义筛选：「全部显示」是 UI-Menus-WorldMap-Filter-All，「全部隐藏」本作加的 */}
            <div className={styles.mapFilterBar}>
              <Button small disabled={hiddenCount === 0} onClick={() => setHidden(new Set())}>
                全部显示
              </Button>
              <Button
                small
                disabled={hiddenCount === legend.length}
                onClick={() => setHidden(new Set(legend.map((l) => l.key)))}
              >
                全部隐藏
              </Button>
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
        </div>

        <p className={styles.mapHint}>底图和图标取自原作</p>
      </div>
    </section>
  );
}
