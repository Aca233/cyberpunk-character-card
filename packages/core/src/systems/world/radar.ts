/**
 * 周边雷达（places-plan §十三①，用户同意写入，2026-10-30）：按玩家所在地点的坐标挑最近的锚点，
 * 给方位和直线距离。【地点】一节用它列玩家附近的地方（用户定的"统一为地点"，2026-11-02）。
 * 放在世界系统里：出行依赖世界，世界不能反过来读出行的内部文件。
 * 锚点由 content 包放在 data.radar（存档记下的地点经 world 的 data 钩子并进来）；方位和距离先按直线算，路程以后再加。
 */
import type { LocationDef } from "./schema";

export interface RadarAnchor {
  readonly id: string;
  readonly name: string;
  readonly kind: string | null;
  readonly x: number;
  readonly y: number;
}

export interface RadarHit {
  readonly id: string;
  readonly name: string;
  readonly kind: string | null;
  /** 八方位：北、东北、东…… */
  readonly dir: string;
  /** 直线距离（米），取整到 10 米 */
  readonly meters: number;
}

/** 列几个：§十三① 写的 8 到 12 个，取 10（本作改编） */
export const RADAR_SIZE = 10;
/** 底图 1 个百分点约多少米：画框世界 X、Y 都是 7800 米对应 0..100（map.ts） */
export const METERS_PER_PERCENT = 78;
/** 太远的不算"周边"（本作改编）：超过这个距离就不列 */
export const RADAR_MAX_METERS = 1500;

const DIRS = ["东", "东北", "北", "西北", "西", "西南", "南", "东南"] as const;

function radarOf(data: Readonly<Record<string, unknown>>): readonly RadarAnchor[] {
  const raw = data.radar;
  return Array.isArray(raw) ? (raw as readonly RadarAnchor[]) : [];
}

/** 从 here 看过去的八方位；底图 y 向下，所以北是 y 变小 */
function directionOf(dx: number, dy: number): string {
  const angle = Math.atan2(-dy, dx);
  const i = Math.round(angle / (Math.PI / 4));
  return DIRS[(i + 8) % 8] as string;
}

/** 玩家所在地点周边最近的锚点；所在地点不在地图上时是空的 */
export function radarAround(
  data: Readonly<Record<string, unknown>>,
  here: LocationDef | undefined,
): RadarHit[] {
  if (!here || here.x === undefined || here.y === undefined) return [];
  const { x, y } = here;
  return radarOf(data)
    .filter((a) => a.id !== here.id)
    .map((a) => {
      const dx = a.x - x;
      const dy = a.y - y;
      return { a, dx, dy, m: Math.hypot(dx, dy) * METERS_PER_PERCENT };
    })
    .filter((h) => h.m <= RADAR_MAX_METERS)
    .sort((p, q) => p.m - q.m || p.a.id.localeCompare(q.a.id))
    .slice(0, RADAR_SIZE)
    .map(({ a, dx, dy, m }) => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      dir: m < 20 ? "就在旁边" : directionOf(dx, dy),
      meters: Math.round(m / 10) * 10,
    }));
}
