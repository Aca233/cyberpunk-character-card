import type { GameContent } from "@cp/core";
import { items } from "./items";
import { npcs } from "./npcs";

export { sampleCharacters } from "./characters";
export { items } from "./items";
export { npcs } from "./npcs";

/** 新存档放进世界的内容 */
export const gameContent: GameContent = { npcs };

/** 结算时传给各系统的静态数据表 */
export const gameData: Readonly<Record<string, unknown>> = { items };
