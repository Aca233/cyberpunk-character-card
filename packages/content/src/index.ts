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
import { ncpdAlerts } from "./ncpd";
import { npcs } from "./npcs";
import { openings } from "./openings";
import { ripperdocs } from "./ripperdocs";
import { apartments, homes } from "./safehouses";
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
export { apartments, homes } from "./safehouses";
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
  // 原剧第 1–6 集节点（canonTimeline）属于以后的 2075 剧本；现在只做 2077 开局，《边缘行者》已经是过去的事，不放进来
};
