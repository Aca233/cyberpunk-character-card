import {
  DISTRICT_SHAPES,
  MAP_POIS,
  type MapPoiKind,
  SUBDISTRICT_SHAPES,
} from "@cp/content/mapShapes";
import { RADAR_ANCHORS, type RadarAnchor } from "@cp/content/radar";
import { type CSSProperties, useId, useMemo, useState } from "react";
import { asset } from "../../assets";
import { cssUrl, MissingAsset } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { FrameBox } from "../../ui/FrameBox";
import { MapShapes } from "../story/MapPanel";
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
} from "../story/mapCamera";
import story from "../story/story.module.css";
import styles from "./characters.module.css";

/**
 * 自由沙盘开局地点选择器：
 * 可选的点就是周边雷达的锚点 RADAR_ANCHORS，和服务端白名单同一份；坐标照原作，不编。
 * 未手动指定时，开局地点跟随当前所选出身的生活圈默认地点（街头/沃森 H10、恶土、公司广场等）。
 */

/** 找不到出身对应地点时的兜底开局锚点：超级摩天楼 H10 */
export const DEFAULT_START = "megabuilding-h10";

const ANCHOR = new Map(RADAR_ANCHORS.map((a) => [a.id, a]));
/** 服务点锚点 id 是 poi:<原作 id>，图标照原作同类标记 */
const POI_KIND = new Map<string, MapPoiKind>(MAP_POIS.map((p) => [`poi:${p.id}`, p.kind]));

/** 锚点的显示名：服务点没有店名时 name 就是类别名，不再重复 */
export function anchorLabel(a: RadarAnchor): string {
  return a.kind && a.kind !== a.name ? `${a.name} · ${a.kind}` : a.name;
}

/** 按 id 找锚点；旧草稿里的地点不在表里时返回 undefined，调用方退回默认 */
export function startAnchor(id: string | undefined): RadarAnchor | undefined {
  return id === undefined ? undefined : ANCHOR.get(id);
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

export function StartMapPicker({
  value,
  defaultStart = DEFAULT_START,
  automatic = false,
  onChange,
}: {
  /** 选中的锚点 id */
  readonly value: string;
  /** 出身对应的默认开局锚点 id */
  readonly defaultStart?: string;
  readonly automatic?: boolean;
  readonly onChange: (id: string) => void;
}) {
  const tiles = useMapTiles();
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
    dragStart,
    dragMove,
    dragEnd,
    keyPan,
  } = useMapCamera();
  const [query, setQuery] = useState("");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const searchId = useId();
  const picked = ANCHOR.get(value);
  const hovered = hoveredId ? ANCHOR.get(hoveredId) : undefined;
  const resetAnchor = ANCHOR.get(defaultStart) ?? ANCHOR.get(DEFAULT_START);
  const info = asset(MAP);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return [];
    return RADAR_ANCHORS.filter(
      (a) => a.name.toLowerCase().includes(q) || (a.kind ?? "").toLowerCase().includes(q),
    );
  }, [query]);

  const choose = (a: RadarAnchor, focus: boolean) => {
    onChange(a.id);
    if (focus) lookAt(a.x, a.y, POI_ZOOM);
  };

  // 原作固定地点一直画；地标/地铁站与服务点也按屏幕格子抽稀直接展示，放大后再铺开更密的点
  const pins: RadarAnchor[] = [];
  const pois: { readonly a: RadarAnchor; readonly style: CSSProperties }[] = [];
  if (size.w > 0) {
    const pinStep = zoom >= SUB_ZOOM ? 20 : 34;
    const poiStep = zoom >= POI_ZOOM ? 22 : 34;
    const pinCells = new Set<string>();
    const poiCells = new Set<string>();

    // 先把固定地点占格记下来，避免低倍率下地标和服务点叠到主地点上面
    for (const a of RADAR_ANCHORS) {
      if (a.kind !== null && a.id !== value) continue;
      const at = toScreen(a.x, a.y);
      if (!onScreen(at)) continue;
      pinCells.add(`${Math.round(at.left / pinStep)}:${Math.round(at.top / pinStep)}`);
      poiCells.add(`${Math.round(at.left / poiStep)}:${Math.round(at.top / poiStep)}`);
      if (a.id !== value) pins.push(a);
    }

    for (const a of RADAR_ANCHORS) {
      if (a.id === value || a.kind === null) continue;
      const at = toScreen(a.x, a.y);
      if (!onScreen(at)) continue;
      const kind = POI_KIND.get(a.id);
      if (kind) {
        const cell = `${Math.round(at.left / poiStep)}:${Math.round(at.top / poiStep)}`;
        const style = iconStyle(poiIcon(kind), at);
        if (poiCells.has(cell) || !style) continue;
        poiCells.add(cell);
        pois.push({ a, style });
      } else {
        const cell = `${Math.round(at.left / pinStep)}:${Math.round(at.top / pinStep)}`;
        if (zoom < SUB_ZOOM && pinCells.has(cell)) continue;
        pinCells.add(cell);
        pins.push(a);
      }
    }
  }

  // 名字：选中的先摆，原作固定地点其次，剩余空位再摆地标/地铁站名；放不下时悬停显示
  const sides = new Map<string, "right" | "left" | "hidden">();
  {
    const boxes: Box[] = [];
    const order = [
      ...(picked ? [picked] : []),
      ...pins.filter((a) => a.kind === null),
      ...pins.filter((a) => a.kind !== null),
    ];
    for (const a of order) {
      const at = toScreen(a.x, a.y);
      const w = a.name.length * 13 + 12;
      const right: Box = { x0: at.left + 10, y0: at.top - 9, x1: at.left + 10 + w, y1: at.top + 9 };
      const left: Box = { x0: at.left - 10 - w, y0: at.top - 9, x1: at.left - 10, y1: at.top + 9 };
      if (!overlaps(right, boxes)) {
        boxes.push(right);
        sides.set(a.id, "right");
      } else if (!overlaps(left, boxes)) {
        boxes.push(left);
        sides.set(a.id, "left");
      } else {
        sides.set(a.id, "hidden");
      }
    }
  }

  const pin = (a: RadarAnchor) => {
    const here = a.id === value;
    const kind = POI_KIND.get(a.id);
    return (
      <div
        key={a.id}
        className={story.mapDest}
        data-picked={here || undefined}
        style={toScreen(a.x, a.y)}
      >
        {here && <span className={story.mapHereTag}>开局在这里</span>}
        <i className={story.mapPinShadow} aria-hidden="true" />
        <button
          type="button"
          className={story.mapDestPin}
          style={kind ? iconStyle(poiIcon(kind)) : undefined}
          title={anchorLabel(a)}
          aria-label={`开局地点：${anchorLabel(a)}`}
          aria-pressed={here}
          onMouseEnter={() => setHoveredId(a.id)}
          onMouseLeave={() => setHoveredId((cur) => (cur === a.id ? null : cur))}
          onFocus={() => setHoveredId(a.id)}
          onBlur={() => setHoveredId((cur) => (cur === a.id ? null : cur))}
          onClick={() => choose(a, false)}
        />
        <span className={story.mapDestLabel} data-side={sides.get(a.id) ?? "hidden"}>
          {a.name}
        </span>
      </div>
    );
  };

  return (
    <div className={styles.startPicker}>
      <div className={styles.startSearch}>
        <label htmlFor={searchId}>搜地点</label>
        <FrameBox className={styles.searchBox}>
          <input
            id={searchId}
            type="search"
            value={query}
            placeholder="名字或类别，比如：义体医生、地铁站"
            onChange={(e) => setQuery(e.target.value)}
          />
        </FrameBox>
        <Button
          small
          disabled={!resetAnchor || automatic}
          onClick={() => {
            if (resetAnchor) {
              onChange("");
              lookAt(resetAnchor.x, resetAnchor.y, POI_ZOOM);
            }
          }}
        >
          {automatic ? "已跟随出身" : "跟随出身"} · {resetAnchor?.name ?? "出身起点"}
        </Button>
      </div>
      {query.trim() !== "" && (
        <ul className={styles.startResults} aria-label="搜到的地点">
          {results.length === 0 && <li className={story.dim}>地图上没有叫这个的地方</li>}
          {results.map((a) => (
            <li key={a.id}>
              <Button small pressed={a.id === value} onClick={() => choose(a, true)}>
                {anchorLabel(a)}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <section aria-label="开局地点地图" className={styles.startMap} style={pinVars()}>
        {/* 不借剧情地图的 mapTop：它带下边框和渐变，捏人页不新加这两样（项目约束） */}
        <header className={styles.startMapTop}>
          <h3 className={story.mapTopTitle}>夜之城</h3>
          <span className={story.dim}>
            {hovered
              ? `悬停：${anchorLabel(hovered)}`
              : picked
                ? `开局地点：${anchorLabel(picked)}`
                : "还没选开局地点"}
          </span>
          <div className={story.mapTools}>
            <span className={story.mapZoom}>
              <Button small label="缩小" onClick={() => zoomBy(1 / 1.4)}>
                −
              </Button>
              <span className={story.dim}>{zoom.toFixed(1)}×</span>
              <Button small label="放大" onClick={() => zoomBy(1.4)}>
                ＋
              </Button>
              <Button small onClick={reset}>
                复位
              </Button>
            </span>
          </div>
        </header>

        <div
          ref={viewport}
          className={story.mapViewport}
          data-dragging={dragging || undefined}
          role="application"
          aria-label="选开局地点的地图：滚轮或加减号缩放，拖动或方向键平移，点图钉选地点"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: 地图要能用键盘平移和缩放
          tabIndex={0}
          onPointerDown={(e) => {
            if (onOverlay(e.target)) return;
            dragStart(e);
          }}
          onPointerMove={(e) => {
            dragMove(e);
          }}
          onPointerUp={dragEnd}
          onPointerCancel={dragEnd}
          onKeyDown={(e) => {
            keyPan(e);
          }}
        >
          {size.w > 0 && (
            <>
              <div
                className={story.mapWorld}
                style={{
                  left: toScreen(0, 0).left,
                  top: toScreen(0, 0).top,
                  width: cam.k * 100,
                  height: cam.k * 100,
                }}
              >
                {tiles ? null : info ? (
                  <img src={info.url} alt="" className={story.mapImage} draggable={false} />
                ) : (
                  <MissingAsset id={MAP} />
                )}
                {tileImages(tiles, cam, size, toScreen(0, 0)).map((t) => (
                  <img
                    key={t.key}
                    src={t.src}
                    alt=""
                    className={story.mapTile}
                    draggable={false}
                    decoding="async"
                    style={{ left: t.left, top: t.top, width: t.size, height: t.size }}
                  />
                ))}
              </div>
              <span
                className={story.mapGrid}
                style={{ backgroundImage: cssUrl("fx.grid") }}
                aria-hidden
              />
              <MapShapes labels={false} viewBox={shapesViewBox(cam, size)} />

              {zoom >= SUB_ZOOM &&
                SUBDISTRICT_SHAPES.map((s) => {
                  const at = toScreen(s.label[0], s.label[1]);
                  return onScreen(at) ? (
                    <span key={s.id} className={story.mapName} data-level="sub" style={at}>
                      {s.name}
                    </span>
                  ) : null;
                })}
              {DISTRICT_SHAPES.map((d) => {
                const at = toScreen(d.label[0], d.label[1]);
                return onScreen(at) ? (
                  <span
                    key={d.id}
                    className={story.mapName}
                    data-level="district"
                    data-faint={zoom >= SUB_ZOOM || undefined}
                    style={at}
                  >
                    {d.name}
                  </span>
                ) : null;
              })}

              {pois.map(({ a, style }) => (
                <button
                  key={a.id}
                  type="button"
                  className={story.mapPoi}
                  data-kind={POI_KIND.get(a.id)}
                  data-go=""
                  style={style}
                  title={anchorLabel(a)}
                  aria-label={`开局地点：${anchorLabel(a)}`}
                  aria-pressed={false}
                  onMouseEnter={() => setHoveredId(a.id)}
                  onMouseLeave={() => setHoveredId((cur) => (cur === a.id ? null : cur))}
                  onFocus={() => setHoveredId(a.id)}
                  onBlur={() => setHoveredId((cur) => (cur === a.id ? null : cur))}
                  onClick={() => choose(a, false)}
                />
              ))}
              {pins.map(pin)}
              {picked && pin(picked)}
              {hovered && POI_KIND.has(hovered.id) && hovered.id !== value && (
                <span className={styles.mapPoiTip} style={toScreen(hovered.x, hovered.y)}>
                  {anchorLabel(hovered)}
                </span>
              )}
            </>
          )}
          <p className={story.mapHint}>
            {zoom < POI_ZOOM ? "滚轮或放大可展开更密集的店面与地铁站 · " : ""}
            悬停查看点名 · 底图和图标取自原作
          </p>
        </div>
      </section>
    </div>
  );
}
