import type { GameContent } from "@cp/core";
import { agendas } from "./agendas";
import { arcs } from "./arcs";
import { braindances } from "./braindance";
import { chipContents } from "./chips";
import { cyberware } from "./cyberware";
import { encounters } from "./encounters";
import { everydayLife, everydayPeople } from "./everydayLife";
import { factions } from "./factions";
import { fixers } from "./fixers";
import { quickhacks } from "./hacking";
import { items } from "./items";
import { consequences, jobTemplates, twists } from "./jobs";
import { loadouts } from "./loadouts";
import { locations } from "./locations";
import { canonTimeline } from "./lore";
import { DISTRICT_CENTERS, ROUTE_ALIASES } from "./map";
// 经 mapShapes.ts 去掉了中间人一类图钉和服务点（用户 2026-11-02："地图上不要搞专门的中间人了，都是npc"）
import { DISTRICT_SHAPES, MAP_POI_KINDS, SERVICE_POINTS, SUBDISTRICT_SHAPES } from "./mapShapes";
import { merchantSites } from "./merchant-sites";
import { ncpdAlerts } from "./ncpd";
import { npcs } from "./npcs";
import { npcTies } from "./npcTies";
import { openings } from "./openings";
import { RADAR_ANCHORS } from "./radar";
import { ripperdocs } from "./ripperdocs";
import { ROAD_SPOTS } from "./roadSpots.gen";
import { ROUTE_ANCHORS, ROUTE_METERS } from "./routeTable.gen";
import { apartments, homes } from "./safehouses";
import { shops } from "./shops";
import { sidegigs } from "./sidegigs";
import { DISTRICT_LAWS, FIXER_TEMPERAMENTS, NIGHT_CITY_SLICES } from "./slices";
import { vehicles } from "./vehicles";

export { agendas } from "./agendas";
export { arcs } from "./arcs";
export { braindances } from "./braindance";
export {
  buildVCharacterCard,
  sampleCharacters,
  type VGender,
  type VOriginKey,
} from "./characters";
export { chipContents } from "./chips";
export { cyberware } from "./cyberware";
export { encounters } from "./encounters";
export { everydayLife, everydayPeople } from "./everydayLife";
export { factions } from "./factions";
// 原作快速移动点（数据终端 + 地铁站）：经 fastTravel.ts 补全 24 处核心狗镇/城区/恶土地标坐标并剔除 18 处废弃/无设施占位点；只当地标，不传送（用户定的：不要快速移动）
export { FAST_TRAVEL_POINTS, type FastTravelPoint } from "./fastTravel";
export { fixers } from "./fixers";
export { quickhacks } from "./hacking";
export { items } from "./items";
export { consequences, jobTemplates, twists } from "./jobs";
export { DEFAULT_LOADOUT, loadouts } from "./loadouts";
export { locations } from "./locations";
export { canonTimeline, glossary } from "./lore";
export { DISTRICT_CENTERS, MAP_SPOTS } from "./map";
// 原作世界地图服务点（含往日之影狗镇），id 与 MAP_POIS 相同；名字只取原作写明的关联，查不到为 null。见 docs/places-plan.md 第五节。
// 中间人一类已去掉（用户 2026-11-02："地图上不要搞专门的中间人了，都是npc"）
export { SERVICE_POINTS, type ServicePoint, type ServicePointKind } from "./mapShapes";
export { merchantSites } from "./merchant-sites";
export { boardModules } from "./modules";
export { ncpdAlerts } from "./ncpd";
export { npcs, vMaleNpcVariant } from "./npcs";
export { npcTies } from "./npcTies";
export {
  DEFAULT_OPENING,
  type OpeningContext,
  openingPremise,
  openings,
} from "./openings";
// 开局地点“在地图上选择”（用户定的，2026-10-30）：选点与服务端校验共用已有锚点，不为缺坐标的地点补造位置
export { RADAR_ANCHORS, type RadarAnchor } from "./radar";
export { ripperdocs } from "./ripperdocs";
// 地图锚点（固定地点、poi:服务点、ft:地标）两两之间沿原作路面网格的路程，整数米；步行和开车先合在一起（用户定的）。见 docs/places-plan.md 第七节"简单版做法"
export { ROUTE_ANCHORS, type RouteAnchor, routeMeters } from "./routeTable.gen";
export { apartments, homes } from "./safehouses";
export { shops } from "./shops";
export { sidegigs } from "./sidegigs";
export {
  DISTRICT_LAWS,
  type DistrictLaw,
  FIXER_TEMPERAMENTS,
  type FixerTemperament,
  NIGHT_CITY_SLICES,
  type NightCitySlice,
} from "./slices";
export { vehicles } from "./vehicles";

/**
 * 建档和剧情结算共用的地点解析数据（用户定的，2026-10-30：开局地点“在地图上选择”）。
 * 地标、服务点和城区形状沿用原作数据，不另编坐标
 */
const mapData = {
  radar: RADAR_ANCHORS,
  mapAreas: {
    districts: DISTRICT_SHAPES,
    subdistricts: SUBDISTRICT_SHAPES,
    centers: DISTRICT_CENTERS,
    kinds: MAP_POI_KINDS,
  },
  servicePoints: SERVICE_POINTS,
  merchantSites,
};

/** 新存档放进世界的内容 */
export const gameContent: GameContent = {
  npcs,
  npcTies,
  fixers,
  items,
  cyberware,
  shops,
  ripperdocs,
  locations,
  openings,
  loadouts,
  quickhacks,
  vehicles,
  homes,
  factions,
  mapData,
  defaultCast: openings[0]?.cast ?? [],
};

/** 结算时传给各系统的静态数据表 */
export const gameData: Readonly<Record<string, unknown>> = {
  items,
  cyberware,
  locations,
  ripperdocs,
  shops,
  quickhacks,
  encounters,
  vehicles,
  factions,
  agendas,
  arcs,
  braindances,
  chipContents,
  everydayLife,
  everydayPeople,
  ncpdAlerts,
  twists,
  consequences,
  jobTemplates,
  sidegigs,
  homes,
  apartments,
  // 路面距离表（places-plan §七 简单版做法）；出行系统按 data.routes 查，表里没有的地点先直线连到最近的锚点，再按路面距离算；
  // aliases 是坐标直接取自某个锚点的地点，当作那个锚点查（map.ts 的 ROUTE_ALIASES）
  routes: { anchors: ROUTE_ANCHORS, meters: ROUTE_METERS, aliases: ROUTE_ALIASES },
  // 和建档共用同一份（见上面 mapData）：
  // radar 是周边雷达的锚点（§十三①），【地点】一节按玩家坐标挑最近的列出来；
  // mapAreas 给新地点推算坐标（places-plan §四）：城区、街区轮廓和标签点，城区中心，服务点类别名；
  // servicePoints 是原作服务点（§五）：【地点】按类别名列，poi: 第一次去时记进存档
  ...mapData,
  // 原作路面的路边点（3dmap_roads 主连通分量，25 m 一格去重，x、y 交替摊平）：模型新建的地点贴到最近的路边（用户定的"先贴路面"，2026-10-30），坐标本作改编
  roadSpots: ROAD_SPOTS,
  // 城区物理安检法则、中间人脾气、百态生活切片与 2077 世界大事件时间线
  districtLaws: DISTRICT_LAWS,
  fixerTemperaments: FIXER_TEMPERAMENTS,
  nightCitySlices: NIGHT_CITY_SLICES,
  canon: canonTimeline,
};
