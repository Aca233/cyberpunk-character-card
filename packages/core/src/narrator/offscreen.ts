import { MACRO_OFFSCREEN_SYSTEM } from "./offscreen-macro";
import { SOCIAL_OFFSCREEN_SYSTEM } from "./offscreen-social";

/** 场外推演：辅助模型，温度略高，城里的事与人物日常才有自然变化 */
export const OFFSCREEN_TEMPERATURE = 0.6;

/** 供剧透视图展示的双路场外推演系统说明 */
export const OFFSCREEN_SYSTEM = [
  "=== 通道 A：宏观局势推演 ===",
  MACRO_OFFSCREEN_SYSTEM,
  "=== 通道 B：人物生活与社交推演 ===",
  SOCIAL_OFFSCREEN_SYSTEM,
].join("\n\n");

export * from "./offscreen-macro";
export * from "./offscreen-merchants";
export * from "./offscreen-social";
export * from "./offscreen-trigger";
