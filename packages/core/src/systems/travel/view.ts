import type { ViewContext } from "../../kernel/system";
import { locationCatalog } from "../world";
import { routeOptions, tripWorldOf } from "./apply";
import { VEHICLE_CLASS_LABELS, VEHICLE_CONDITION_LABELS } from "./schema";
import { vehicleCatalog } from "./vehicles";

/** 地图上的地点和到每个地点的路线、名下的车和这一场的路上偶遇；路线面板照这里显示，结算用同一套算法 */
export function travelView({ world, data }: ViewContext) {
  const w = tripWorldOf(world);
  const destinations = [...locationCatalog(data).values()].flatMap((p) =>
    p.x === undefined || p.y === undefined
      ? []
      : [
          {
            id: p.id,
            name: p.name,
            district: p.district,
            x: p.x,
            y: p.y,
            metro: p.metro === true,
            here: p.id === w.location,
            routes: p.id === w.location ? [] : routeOptions(w, data, p.id),
          },
        ],
  );
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
  return {
    destinations,
    vehicles,
    encounter: encounter
      ? { label: encounter.label, note: encounter.note, district: encounter.district }
      : null,
  };
}
