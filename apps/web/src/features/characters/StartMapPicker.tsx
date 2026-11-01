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
 * 捏人第 7 步：在地图上选开局地点（用户定的"在地图上选择"，2026-10-30）。
 * 可选的点就是周边雷达的锚点 RADAR_ANCHORS，和服务端白名单同一份；坐标照原作，不编。
 * 只换玩家开局站在哪：引导委托、出场人物、行装不变，芯片交货地仍是丽姿酒吧（服务端 openingPremise 会写明）
 */

/** 没选时的开局地点：开场自带的丽姿酒吧 */
export const DEFAULT_START = "lizzies-bar";

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
  onChange,
}: {
  /** 选中的锚点 id */
  readonly value: string;
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
  const searchId = useId();
  const picked = ANCHOR.get(value);
  const info = asset(MAP);

  const results = useMemo(() => {
    const q = query.trim();
    if (q === "") return [];
    return RADAR_ANCHORS.filter((a) => a.name.includes(q) || (a.kind ?? "").includes(q)).slice(
      0,
      8,
    );
  }, [query]);

  const choose = (a: RadarAnchor, focus: boolean) => {
    onChange(a.id);
    if (focus) lookAt(a.x, a.y, POI_ZOOM);
  };

  // 原作固定地点一直画；地铁站和地标放大到能看街区名时画；服务点放大到能看店时画，挤在一起的只留一个
  const pins: RadarAnchor[] = [];
  const pois: { readonly a: RadarAnchor; readonly style: CSSProperties }[] = [];
  if (size.w > 0) {
    const taken = new Set<string>();
    for (const a of RADAR_ANCHORS) {
      if (a.id === value) continue;
      const at = toScreen(a.x, a.y);
      if (!onScreen(at)) continue;
      const kind = POI_KIND.get(a.id);
      if (kind) {
        if (zoom < POI_ZOOM) continue;
        const cell = `${Math.round(at.left / 24)}:${Math.round(at.top / 24)}`;
        const style = iconStyle(poiIcon(kind), at);
        if (taken.has(cell) || !style) continue;
        taken.add(cell);
        pois.push({ a, style });
      } else if (a.kind === null || zoom >= SUB_ZOOM) {
        pins.push(a);
      }
    }
  }

  // 名字：选中的先摆，原作固定地点其次；右边放不下放左边，再放不下只在悬停时显示
  const sides = new Map<string, "right" | "left" | "hidden">();
  {
    const boxes: Box[] = [];
    const order = [...(picked ? [picked] : []), ...pins.filter((a) => a.kind === null)];
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
        <input
          id={searchId}
          className={styles.startInput}
          type="search"
          value={query}
          placeholder="名字或类别，比如：义体医生、地铁站"
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button
          small
          disabled={value === DEFAULT_START}
          onClick={() => {
            const a = ANCHOR.get(DEFAULT_START);
            if (a) choose(a, true);
          }}
        >
          回到丽姿酒吧
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
            {picked ? `开局地点：${anchorLabel(picked)}` : "还没选开局地点"}
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
                  onClick={() => choose(a, false)}
                />
              ))}
              {pins.map(pin)}
              {picked && pin(picked)}
            </>
          )}
          <p className={story.mapHint}>
            {zoom < POI_ZOOM ? "放大能看到更多店和地铁站 · " : ""}底图和图标取自原作
          </p>
        </div>
      </section>
    </div>
  );
}
