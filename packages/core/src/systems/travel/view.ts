import type { ViewContext } from "../../kernel/system";
import {
  landmarkAnchors,
  locationCatalog,
  locationForTravel,
  serviceAnchors,
  WorldClockStateSchema,
} from "../world";
import { routeOptions, tripWorldOf } from "./apply";
import { VEHICLE_CLASS_LABELS, VEHICLE_CONDITION_LABELS } from "./schema";
import { vehicleCatalog } from "./vehicles";

/** 地图上的地点和到每个地点的路线、名下的车和这一场的路上偶遇；路线面板照这里显示，结算用同一套算法 */
export function travelView({ world, data }: ViewContext) {
  const w = tripWorldOf(world);
  const book = new Map(
    WorldClockStateSchema.parse(world.slices.world).places.map((p) => [p.id, p]),
  );
  const destinations = [...locationCatalog(data).values()].flatMap((p) => {
    const saved = book.get(p.id);
    const here = p.id === w.location;
    if (p.x === undefined || p.y === undefined) return [];
    return [
      {
        id: p.id,
        name: p.name,
        district: p.district,
        x: p.x,
        y: p.y,
        metro: p.metro === true,
        /** 哪一层：fixed 原作固定地点，place 剧情里新到的，poi 原作服务点，ft 原作地标；只决定地图上的图标 */
        layer: !saved
          ? ("fixed" as const)
          : p.id.startsWith("poi:")
            ? ("poi" as const)
            : p.id.startsWith("ft:")
              ? ("ft" as const)
              : ("place" as const),
        /** 服务点的类别（gun、ripperdoc……），地图上照原作图标画 */
        kind: saved?.kind ?? null,
        here,
        /** 原作服务点还没去过：地图上只在原作图标那一层显示，点了照常出行 */
        firstVisit: false,
        routes: here ? [] : routeOptions(w, data, p.id),
      },
    ];
  });
  // 原作服务点第一次去：预览只算路线，不写存档；到达时由 world 记下
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
      layer: "poi" as const,
      kind: anchor.kind,
      here: false,
      firstVisit: true,
      routes: routeOptions(w, data, def.id),
    });
    known.add(def.id);
  }
  // 原作地标（数据终端、地铁站）第一次去：同上，只算路线；照常出行，不传送（用户定的"画出来，走普通出行"，2026-11-02）
  for (const anchor of landmarkAnchors(data)) {
    if (known.has(anchor.id)) continue;
    const def = locationForTravel(data, anchor.id);
    if (!def || def.x === undefined || def.y === undefined) continue;
    destinations.push({
      id: def.id,
      name: def.name,
      district: def.district,
      x: def.x,
      y: def.y,
      metro: anchor.kind === "地铁站",
      layer: "ft" as const,
      kind: null,
      here: false,
      firstVisit: true,
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
      location: v.location,
      locationName:
        v.location === null
          ? "未知地点"
          : (locationForTravel(data, v.location)?.name ?? v.location),
      here: v.location !== null && v.location === w.location,
      selected: v.id === w.travel.activeVehicleId,
    };
  });
  return {
    destinations,
    vehicles,
    encounter: encounter
      ? { label: encounter.label, note: encounter.note, district: encounter.district }
      : null,
  };
}
