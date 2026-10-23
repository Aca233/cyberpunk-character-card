import type { GameContent } from "@cp/core";
import { fixers } from "./fixers";
import { items } from "./items";
import { twists } from "./jobs";
import { locations } from "./locations";
import { npcs } from "./npcs";
import { openings } from "./openings";

export { sampleCharacters } from "./characters";
export { fixers } from "./fixers";
export { items } from "./items";
export { twists } from "./jobs";
export { locations } from "./locations";
export { glossary } from "./lore";
export { npcs } from "./npcs";
export { DEFAULT_OPENING, openingPremise, openings } from "./openings";

/** 新存档放进世界的内容 */
export const gameContent: GameContent = { npcs, fixers, items, locations, openings };

/** 结算时传给各系统的静态数据表 */
export const gameData: Readonly<Record<string, unknown>> = { items, locations, twists };
