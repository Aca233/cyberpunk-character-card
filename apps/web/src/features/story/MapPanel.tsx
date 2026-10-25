import { useEffect, useMemo, useState } from "react";
import { type AssetId, asset } from "../../assets";
import { MissingAsset } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { Panel } from "../../ui/Panel";
import styles from "./story.module.css";
import type { View } from "./view";

export type MapDestination = View["travel"]["destinations"][number];
export type MapRoute = MapDestination["routes"][number];

const LAYERS: readonly [AssetId, string][] = [
  ["map.blue", "线框"],
  ["map.albedo", "实景"],
];

/** 地图和路线面板：原作底图上标出地点，点一个看各种走法；耗时、路费和风险由代码按路线表算，不调用模型 */
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
  const [layer, setLayer] = useState<AssetId>("map.blue");
  const [picked, setPicked] = useState<string | null>(null);
  const destinations = view.travel.destinations;
  const here = destinations.find((d) => d.here);
  const dest = destinations.find((d) => d.id === picked);
  const info = asset(layer);
  const [turf, setTurf] = useState(false);
  // 城区的位置：取城区里已上图地点的平均坐标
  const centers = useMemo(() => {
    const sums = new Map<string, { x: number; y: number; n: number }>();
    for (const d of destinations) {
      const s = sums.get(d.district) ?? { x: 0, y: 0, n: 0 };
      sums.set(d.district, { x: s.x + d.x, y: s.y + d.y, n: s.n + 1 });
    }
    return [...sums].map(([district, s]) => ({ district, x: s.x / s.n, y: s.y / s.n }));
  }, [destinations]);
  const gangs = view.factions.list.filter((f) => f.kind === "gang" && f.turf.length > 0);

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

  return (
    <div className={styles.journalBackdrop}>
      <div role="dialog" aria-label="地图" className={styles.journal}>
        <Panel as="div" title="地图 · 夜之城" line="var(--cp-cyan)">
          <div className={styles.docHead}>
            <p className={`${styles.dim} ${styles.docNote}`}>
              {here ? `现在在${here.name}（${here.district}）` : "现在的位置不在地图上"}
              。点一个地点看怎么去；耗时、路费和风险由代码算，确认后 AI 接着写路上和到达。
            </p>
            <span className={styles.mapLayers}>
              {LAYERS.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={styles.mapLayer}
                  aria-pressed={layer === id}
                  onClick={() => setLayer(id)}
                >
                  {label}
                </button>
              ))}
            </span>
            <button
              type="button"
              className={styles.mapLayer}
              aria-pressed={turf}
              onClick={() => setTurf((t) => !t)}
            >
              帮派地盘
            </button>
            <Button onClick={onClose}>关闭</Button>
          </div>

          <div className={styles.mapBody}>
            <div
              className={styles.mapFrame}
              style={
                info
                  ? { width: `min(100%, calc(70vh * ${(info.width / info.height).toFixed(4)}))` }
                  : undefined
              }
            >
              {info ? (
                <img src={info.url} alt="" className={styles.mapImage} draggable={false} />
              ) : (
                <MissingAsset id={layer} />
              )}
              {turf &&
                centers.map((c) => {
                  const owners = gangs.filter((g) => g.turf.includes(c.district));
                  if (owners.length === 0) return null;
                  return (
                    <div
                      key={c.district}
                      className={styles.turfTag}
                      style={{ left: `${c.x}%`, top: `${c.y}%` }}
                    >
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
                    style={{ left: `${a.x}%`, top: `${a.y}%` }}
                    title={`NCPD 警情：${a.label}（${a.locationName}，赏金 ${a.reward} 欧元，${a.until} 前）`}
                  >
                    !
                  </span>
                ),
              )}
              {destinations.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className={styles.mapPin}
                  data-here={d.here || undefined}
                  data-picked={d.id === picked || undefined}
                  style={{ left: `${d.x}%`, top: `${d.y}%` }}
                  title={`${d.name} · ${d.district}${d.here ? "（你在这里）" : ""}`}
                  aria-label={d.name}
                  onClick={() => setPicked(d.here ? null : d.id)}
                >
                  <span className={styles.mapPinLabel}>{d.name}</span>
                </button>
              ))}
            </div>

            <section className={styles.mapRoutes}>
              {dest ? (
                <>
                  <h3 className={styles.mapTitle}>{dest.name}</h3>
                  <p className={styles.dim}>
                    {dest.district}
                    {dest.metro && " · 有 NCART 轻轨站"}
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
                  在地图上点一个地点。没标出来的地方用输入框写怎么去，时间和花费由 AI 按正文记。
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
            </section>
          </div>
        </Panel>
      </div>
    </div>
  );
}
