/**
 * 地图图钉的对外入口：mapShapes.gen.ts 是生成的、不手改，在这里去掉原作的「中间人」一类
 * （用户 2026-11-02："地图上不要搞专门的中间人了，都是npc"）。中间人就是普通人物，地图上按人物现在所在的地点画。
 * 好车中间人终端（autofixer）是买车的终端，不是人，照留
 */
import * as gen from "./mapShapes.gen";
import { SERVICE_POINTS as ALL_SERVICE_POINTS, type ServicePoint } from "./servicePoints.gen";

export {
  DISTRICT_SHAPES,
  type DistrictShape,
  SUBDISTRICT_SHAPES,
  type SubdistrictShape,
} from "./mapShapes.gen";
export type { ServicePoint } from "./servicePoints.gen";

/** 去掉的图钉类别 */
const DROPPED = "fixer";

export type MapPoiKind = Exclude<gen.MapPoiKind, typeof DROPPED>;

export interface MapPoiKindInfo extends gen.MapPoiKindInfo {
  readonly id: MapPoiKind;
}

export interface MapPoi extends gen.MapPoi {
  readonly kind: MapPoiKind;
}

export const MAP_POI_KINDS: readonly MapPoiKindInfo[] = gen.MAP_POI_KINDS.filter(
  (k): k is MapPoiKindInfo => k.id !== DROPPED,
);

export const MAP_POIS: readonly MapPoi[] = gen.MAP_POIS.filter(
  (p): p is MapPoi => p.kind !== DROPPED,
);

/** 原作服务点同样去掉中间人一类：雷达、【地点】和开局选点都不再出「中间人」 */
export type ServicePointKind = Exclude<ServicePoint["kind"], typeof DROPPED>;

export const SERVICE_POINTS: readonly (ServicePoint & { readonly kind: ServicePointKind })[] =
  ALL_SERVICE_POINTS.filter(
    (p): p is ServicePoint & { readonly kind: ServicePointKind } => p.kind !== DROPPED,
  );
