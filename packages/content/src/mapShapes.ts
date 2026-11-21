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

/**
 * 保留为玩家真实可交互安全屋的 apartment 图钉：
 * - v_room（H10 开局公寓）
 * - dlc6_apart_*（4 套 EZ 地产可购公寓）
 * 其余属于剧情 NPC 住宅或空壳房源（kerry_villa、judys_apartment、river_trailer_park、nomad_camp_01/02、mq300_safehouse），
 * 不作为可交互服务点暴露，避免“点过去什么都没有”。
 */
const PLAYER_APARTMENT_POIS = new Set([
  "v_room",
  "dlc6_apart_cct_dtn",
  "dlc6_apart_hey_gle",
  "dlc6_apart_wat_nid",
  "dlc6_apart_wbr_jpn",
]);

function keepPoi(p: { readonly id: string; readonly kind: string }): boolean {
  if (p.kind === DROPPED) return false;
  if (p.kind === "apartment" && !PLAYER_APARTMENT_POIS.has(p.id)) return false;
  return true;
}

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

export const MAP_POIS: readonly MapPoi[] = gen.MAP_POIS.filter((p): p is MapPoi => keepPoi(p));

/** 原作服务点同样去掉中间人一类与非玩家空壳公寓：雷达、【地点】和开局选点不再出空壳点 */
export type ServicePointKind = Exclude<ServicePoint["kind"], typeof DROPPED>;

export const SERVICE_POINTS: readonly (ServicePoint & { readonly kind: ServicePointKind })[] =
  ALL_SERVICE_POINTS.filter((p): p is ServicePoint & { readonly kind: ServicePointKind } =>
    keepPoi(p),
  );
