/**
 * 周边雷达写进【当前状态】的那一行（places-plan §十三①，用户同意写入，2026-10-30）。
 * 挑点和算方位在世界系统（world/radar.ts）：地点簿的 from + dir + dist 也要用，世界不能读出行的内部文件
 */
import type { RadarHit } from "../world";

/** 【当前状态】里的一行，例如"北 200m 植入不求人（义体医生）poi:wat_kab_ripperdoc_01" */
export function radarLine(hits: readonly RadarHit[]): string | undefined {
  if (hits.length === 0) return undefined;
  const items = hits.map((h) => {
    const label = h.kind && h.kind !== h.name ? `${h.name}（${h.kind}）` : h.name;
    const where = h.dir === "就在旁边" ? "就在旁边" : `${h.dir} ${h.meters}m`;
    return `${where} ${label} ${h.id}`;
  });
  // 地点簿做了以后（§四、§五）poi:、ft: 可以直接当 location，代码第一次去时记进地点簿
  return `周边（代码按原作坐标算的直线方位和距离，不是路程；正文写到附近的店和地标时照这里的名字和方位，不要另编；这里的 id 都能直接写进 world 的 location，也能当 place 的 near 或 from）：${items.join("；")}`;
}
