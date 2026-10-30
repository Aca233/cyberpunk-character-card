import type { GameContent } from "@cp/core";
import { agendas } from "./agendas";
import { arcs } from "./arcs";
import { braindances } from "./braindance";
import { cyberware } from "./cyberware";
import { encounters } from "./encounters";
import { factions } from "./factions";
import { fixers } from "./fixers";
import { quickhacks } from "./hacking";
import { items } from "./items";
import { consequences, jobTemplates, twists } from "./jobs";
import { loadouts } from "./loadouts";
import { locations } from "./locations";
import { DISTRICT_CENTERS } from "./map";
import { DISTRICT_SHAPES, MAP_POI_KINDS, SUBDISTRICT_SHAPES } from "./mapShapes.gen";
import { ncpdAlerts } from "./ncpd";
import { npcs } from "./npcs";
import { openings } from "./openings";
import { RADAR_ANCHORS } from "./radar";
import { ripperdocs } from "./ripperdocs";
import { ROUTE_ANCHORS, ROUTE_METERS } from "./routeTable.gen";
import { apartments, homes } from "./safehouses";
import { SERVICE_POINTS } from "./servicePoints.gen";
import { shops } from "./shops";
import { sidegigs } from "./sidegigs";
import { vehicles } from "./vehicles";

export { agendas } from "./agendas";
export { arcs } from "./arcs";
export { braindances } from "./braindance";
export { sampleCharacters } from "./characters";
export { combos } from "./combos";
export { cyberware } from "./cyberware";
export { encounters } from "./encounters";
export { factions } from "./factions";
// 原作 171 个快速移动点（数据终端 + 地铁站）的名字与所属街区：129 个有场景节点坐标，42 个为 null；只当地标，不传送（用户定的：不要快速移动）。见 docs/places-plan.md 第三、七节
export { FAST_TRAVEL_POINTS, type FastTravelPoint } from "./fastTravel.gen";
export { fixers } from "./fixers";
export { quickhacks } from "./hacking";
export { items } from "./items";
export { consequences, jobTemplates, twists } from "./jobs";
export { lifepath } from "./lifepath";
export { DEFAULT_LOADOUT, loadouts } from "./loadouts";
export { locations } from "./locations";
export { canonTimeline, glossary } from "./lore";
export { DISTRICT_CENTERS, MAP_SPOTS } from "./map";
export { boardModules } from "./modules";
export { ncpdAlerts } from "./ncpd";
export { npcs } from "./npcs";
export { DEFAULT_OPENING, openingPremise, openings } from "./openings";
export { ripperdocs } from "./ripperdocs";
// 地图锚点（固定地点、poi:服务点、ft:地标）两两之间沿原作路面网格的路程，整数米；步行和开车先合在一起（用户定的）。见 docs/places-plan.md 第七节"简单版做法"
export { ROUTE_ANCHORS, type RouteAnchor, routeMeters } from "./routeTable.gen";
export { apartments, homes } from "./safehouses";
// 原作世界地图服务点 174 个（含往日之影狗镇），id 与 MAP_POIS 相同；名字只取原作写明的关联，查不到为 null。见 docs/places-plan.md 第五节
export { SERVICE_POINTS, type ServicePoint, type ServicePointKind } from "./servicePoints.gen";
export { shops } from "./shops";
export { sidegigs } from "./sidegigs";
export { vehicles } from "./vehicles";

/** 新存档放进世界的内容 */
export const gameContent: GameContent = {
  npcs,
  fixers,
  items,
  cyberware,
  locations,
  openings,
  loadouts,
  quickhacks,
  vehicles,
  homes,
  // 没有开场的旧存档种的人
  defaultCast: ["rebecca", "maine", "faraday"],
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
  ncpdAlerts,
  twists,
  consequences,
  jobTemplates,
  sidegigs,
  apartments,
  // 路面距离表（places-plan §七 简单版做法）；出行系统按 data.routes 查，表里没有的地点退回直线
  routes: { anchors: ROUTE_ANCHORS, meters: ROUTE_METERS },
  // 周边雷达的锚点（§十三①）；出行系统按玩家坐标挑最近的写进【当前状态】
  radar: RADAR_ANCHORS,
  // 地点簿推算坐标用（places-plan §四）：城区、街区轮廓和标签点，城区中心，服务点类别名
  mapAreas: {
    districts: DISTRICT_SHAPES,
    subdistricts: SUBDISTRICT_SHAPES,
    centers: DISTRICT_CENTERS,
    kinds: MAP_POI_KINDS,
  },
  // 原作服务点（§五）：place 写 kind 时代码在这里挑一家；poi: 第一次去时记进地点簿
  servicePoints: SERVICE_POINTS,
  // 原剧第 1–6 集节点（canonTimeline）属于以后的 2075 剧本；现在只做 2077 开局，《边缘行者》已经是过去的事，不放进来
};
