import type { GameContent } from "@cp/core";
import { cyberware } from "./cyberware";
import { fixers } from "./fixers";
import { items } from "./items";
import { consequences, jobTemplates, twists } from "./jobs";
import { loadouts } from "./loadouts";
import { locations } from "./locations";
import { canonTimeline } from "./lore";
import { npcs } from "./npcs";
import { openings } from "./openings";
import { ripperdocs } from "./ripperdocs";
import { shops } from "./shops";

export { sampleCharacters } from "./characters";
export { combos } from "./combos";
export { cyberware } from "./cyberware";
export { fixers } from "./fixers";
export { items } from "./items";
export { consequences, jobTemplates, twists } from "./jobs";
export { lifepath } from "./lifepath";
export { DEFAULT_LOADOUT, loadouts } from "./loadouts";
export { locations } from "./locations";
export { canonTimeline, glossary } from "./lore";
export { boardModules } from "./modules";
export { npcs } from "./npcs";
export { DEFAULT_OPENING, openingPremise, openings } from "./openings";
export { ripperdocs } from "./ripperdocs";
export { shops } from "./shops";

/** 新存档放进世界的内容 */
export const gameContent: GameContent = {
  npcs,
  fixers,
  items,
  cyberware,
  locations,
  openings,
  loadouts,
};

/** 结算时传给各系统的静态数据表 */
export const gameData: Readonly<Record<string, unknown>> = {
  items,
  cyberware,
  locations,
  ripperdocs,
  shops,
  twists,
  consequences,
  jobTemplates,
  canon: canonTimeline,
};
