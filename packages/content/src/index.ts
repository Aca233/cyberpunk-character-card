import type { GameContent } from "@cp/core";
import { items } from "./items";
import { locations } from "./locations";
import { npcs } from "./npcs";
import { openings } from "./openings";

export { sampleCharacters } from "./characters";
export { items } from "./items";
export { locations } from "./locations";
export { npcs } from "./npcs";
export { DEFAULT_OPENING, openingPremise, openings } from "./openings";

/** 新存档放进世界的内容 */
export const gameContent: GameContent = { npcs, items, locations, openings };

/** 结算时传给各系统的静态数据表 */
export const gameData: Readonly<Record<string, unknown>> = { items, locations };
