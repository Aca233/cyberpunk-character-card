import { defineSystem } from "../../kernel/system";
import { applySceneSummary } from "./apply";
import {
  type MemoryInternal,
  MemorySceneCommandSchema,
  type MemoryState,
  MemoryStateSchema,
} from "./schema";

/** 剧情记忆：收场后辅助模型写的场景摘要；模型不能直接写，由回合流程在收场时发出 */
export const memory = defineSystem<MemoryState, never, MemoryInternal>({
  id: "memory",
  dependsOn: ["world"],
  state: MemoryStateSchema,
  initial: () => ({ scenes: [] }),
  commands: {},
  internal: {
    "memory.scene": MemorySceneCommandSchema,
  },
  apply(draft, command, ctx) {
    return applySceneSummary(draft, command, ctx.now);
  },
});

export * from "./apply";
export * from "./prompt";
export * from "./schema";
