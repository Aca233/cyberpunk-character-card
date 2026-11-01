import { type MouseEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { api, type SaveSummary } from "../../api/client";
import { type AssetId, asset } from "../../assets";
import { MapShapes } from "../story/MapPanel";
import styles from "./calibrate.module.css";

interface Spot {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly metro: boolean;
  readonly moved: boolean;
}

/** 和剧情里的地图同一张底图：原作道路网格烘焙的俯视图 */
const MAP: AssetId = "map.roads";

/** 坐标取到 0.5% */
const round = (n: number) => Math.round(n * 2) / 2;
const key = (id: string) => (/^[A-Za-z_$][\w$]*$/.test(id) ? id : JSON.stringify(id));

/**
 * 开发用的地图校准页（只在 pnpm dev 下注册）：读一个存档里已上图的地点，
 * 选中一个再点底图改坐标，最后把生成的 MAP_SPOTS 片段抄回 packages/content/src/map.ts
 */
export function Calibrate() {
  const [shapes, setShapes] = useState(true);
  const [saves, setSaves] = useState<readonly SaveSummary[]>([]);
  const [spots, setSpots] = useState<readonly Spot[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [newId, setNewId] = useState("");
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const info = asset(MAP);

  useEffect(() => {
    api
      .saves()
      .then(setSaves)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const load = async (saveId: string) => {
    try {
      const view = await api.state(saveId);
      setSpots(
        // 没去过的原作店（places-plan 第二期）坐标照原作，不进校准列表
        view.travel.destinations
          .filter((d) => !d.firstVisit)
          .map((d) => ({
            id: d.id,
            name: d.name,
            x: d.x,
            y: d.y,
            metro: d.metro,
            moved: false,
          })),
      );
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const at = (e: MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: round(((e.clientX - r.left) / r.width) * 100),
      y: round(((e.clientY - r.top) / r.height) * 100),
    };
  };
  const update = (id: string, patch: Partial<Spot>) =>
    setSpots((all) => all.map((s) => (s.id === id ? { ...s, ...patch, moved: true } : s)));
  const add = () => {
    const id = newId.trim();
    if (!id || spots.some((s) => s.id === id)) return;
    setSpots((all) => [...all, { id, name: id, x: 50, y: 50, metro: false, moved: true }]);
    setPicked(id);
    setNewId("");
  };
  const snippet = useMemo(
    () =>
      spots.map((s) => `  ${key(s.id)}: { x: ${s.x}, y: ${s.y}, metro: ${s.metro} },`).join("\n"),
    [spots],
  );

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1>地图校准（开发用）</h1>
        <select defaultValue="" onChange={(e) => e.target.value && void load(e.target.value)}>
          <option value="">读一个存档里的地点…</option>
          {saves.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={styles.toggle}
          aria-pressed={shapes}
          onClick={() => setShapes((s) => !s)}
        >
          城区边界
        </button>
        <span className={styles.dim}>
          {cursor ? `光标 ${cursor.x}, ${cursor.y}` : "把光标移到底图上看坐标"}
        </span>
        <Link to="/menu">回主菜单</Link>
      </header>
      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.body}>
        <div className={styles.frame}>
          {info ? (
            <img src={info.url} alt="" className={styles.image} draggable={false} />
          ) : (
            <p className={styles.error}>缺少素材 {MAP}</p>
          )}
          {shapes && <MapShapes />}
          <button
            type="button"
            className={styles.surface}
            aria-label="在底图上点一下，把选中的地点放到这里"
            onMouseMove={(e) => setCursor(at(e))}
            onMouseLeave={() => setCursor(null)}
            onClick={(e) => picked && update(picked, at(e))}
          />
          {spots.map((s) => (
            <button
              key={s.id}
              type="button"
              className={styles.pin}
              data-picked={s.id === picked || undefined}
              data-moved={s.moved || undefined}
              style={{ left: `${s.x}%`, top: `${s.y}%` }}
              title={`${s.name}（${s.id}）`}
              onClick={() => setPicked(s.id)}
            >
              <span className={styles.label}>{s.name}</span>
            </button>
          ))}
        </div>

        <aside className={styles.side}>
          <p className={styles.dim}>
            选中一个地点，再点底图放到准确位置；黄色是改过的。没上图的地点在下面按 id 加。
          </p>
          <ul className={styles.list}>
            {spots.map((s) => (
              <li key={s.id} data-picked={s.id === picked || undefined}>
                <button type="button" className={styles.toggle} onClick={() => setPicked(s.id)}>
                  {s.name}
                </button>
                <code>
                  {s.x}, {s.y}
                </code>
                <label>
                  <input
                    type="checkbox"
                    checked={s.metro}
                    onChange={(e) => update(s.id, { metro: e.target.checked })}
                  />
                  轻轨
                </label>
              </li>
            ))}
          </ul>
          <div className={styles.add}>
            <input
              value={newId}
              placeholder="地点 id，例如 arasaka-tower"
              onChange={(e) => setNewId(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
            />
            <button type="button" className={styles.toggle} onClick={add}>
              加一个
            </button>
          </div>
          <p className={styles.dim}>抄回 MAP_SPOTS：</p>
          <textarea className={styles.snippet} readOnly value={snippet} rows={14} />
        </aside>
      </div>
    </div>
  );
}
