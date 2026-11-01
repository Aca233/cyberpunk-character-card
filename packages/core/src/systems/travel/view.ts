import type { ViewContext } from "../../kernel/system";
import {
  locationCatalog,
  locationForTravel,
  radarAround,
  serviceAnchors,
  WorldClockStateSchema,
} from "../world";
import { roughPlace, routeOptions, tripWorldOf } from "./apply";
import { VEHICLE_CLASS_LABELS, VEHICLE_CONDITION_LABELS } from "./schema";
import { vehicleCatalog } from "./vehicles";

/** 地图上的地点和到每个地点的路线、名下的车和这一场的路上偶遇；路线面板照这里显示，结算用同一套算法 */
export function travelView({ world, data }: ViewContext) {
  const w = tripWorldOf(world);
  // 地点簿（places-plan 第二期）：没转正的临时地点、挂在上级下面的场景点不上地图，玩家正在那里的除外（用户定的，2026-10-30）
  const book = new Map(
    WorldClockStateSchema.parse(world.slices.world).places.map((p) => [p.id, p]),
  );
  const destinations = [...locationCatalog(data).values()].flatMap((p) => {
    const saved = book.get(p.id);
    const here = p.id === w.location;
    if (p.x === undefined || p.y === undefined) return [];
    if (saved && !here && (saved.tempScene !== undefined || saved.parent !== undefined)) return [];
    return [
      {
        id: p.id,
        name: p.name,
        district: p.district,
        x: p.x,
        y: p.y,
        metro: p.metro === true,
        /** 坐标或接路是估的（§七“大概”），地图和面板照这个标 */
        rough: roughPlace(data, p.id),
        /** 哪一层：fixed 地点表，place 剧情里新建的，poi 原作服务点，ft 原作地标（§三） */
        layer: !saved
          ? ("fixed" as const)
          : p.id.startsWith("poi:")
            ? ("poi" as const)
            : p.id.startsWith("ft:")
              ? ("ft" as const)
              : ("place" as const),
        /** 只听说过、没去过（地图上画淡一点） */
        heard: saved?.visitedAt === null,
        /** 服务点的类别（gun、ripperdoc……），地图上照原作图标画 */
        kind: saved?.kind ?? null,
        here,
        /** 原作服务点还没进地点簿：地图上只在原作图标那一层显示，点了照常出行，到了才记进地点簿 */
        firstVisit: false,
        /** 剧情里记下的地点能在地图上拖到准确的位置；场景点跟着上级走，原作的不能拖（places-plan 第二期） */
        movable: p.id.startsWith("place:") && saved !== undefined && saved.parent === undefined,
        /** 玩家拖过：位置是玩家放的，不是核对过的原作入口 */
        moved: saved?.movedAt !== undefined,
        routes: here ? [] : routeOptions(w, data, p.id),
      },
    ];
  });
  // 原作服务点第一次去（places-plan 第二期，用户定的 2026-10-30）：预览只算路线，不写存档；到达时由 world 记进地点簿
  const known = new Set(destinations.map((d) => d.id));
  for (const anchor of serviceAnchors(data)) {
    if (known.has(anchor.id)) continue;
    const def = locationForTravel(data, anchor.id);
    if (!def || def.x === undefined || def.y === undefined) continue;
    destinations.push({
      id: def.id,
      name: def.name,
      district: def.district,
      x: def.x,
      y: def.y,
      metro: def.metro === true,
      rough: roughPlace(data, def.id),
      layer: "poi" as const,
      heard: false,
      kind: anchor.kind,
      here: false,
      firstVisit: true,
      movable: false,
      moved: false,
      routes: routeOptions(w, data, def.id),
    });
  }
  const { encounter } = w.travel;
  const cars = vehicleCatalog(data);
  const vehicles = w.travel.vehicles.map((v) => {
    const def = cars.get(v.model);
    return {
      id: v.id,
      model: v.model,
      name: def?.name ?? v.model,
      maker: def?.maker ?? null,
      classLabel: def ? VEHICLE_CLASS_LABELS[def.class] : "",
      speed: def?.speed ?? 0,
      seats: def?.seats ?? 0,
      trunk: def?.trunk ?? 0,
      condition: v.condition,
      conditionLabel: VEHICLE_CONDITION_LABELS[v.condition],
      stolen: v.stolen,
    };
  });
  const places = locationCatalog(data);
  return {
    destinations,
    vehicles,
    /** 周边雷达（§十三①）：所在地点附近最近的锚点，直线方位和距离；不在地图上时是空的 */
    radar: radarAround(data, w.location === null ? undefined : places.get(w.location)),
    /** 所在地点的坐标本身是估的（§七“大概”）：雷达的方位和距离只作参考 */
    radarRough: w.location !== null && roughPlace(data, w.location),
    encounter: encounter
      ? { label: encounter.label, note: encounter.note, district: encounter.district }
      : null,
  };
}
