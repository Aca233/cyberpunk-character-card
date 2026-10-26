import { defineSystem } from "../../kernel/system";
import { applySceneSummary, editSceneSummary, logMemoryEdit } from "./apply";
import {
  MemoryEditCommandSchema,
  type MemoryInternal,
  MemoryLogCommandSchema,
  MemorySceneCommandSchema,
  type MemoryState,
  MemoryStateSchema,
} from "./schema";

/**
 * 剧情记忆：收场后辅助模型写的场景摘要，和记忆面板的修改记录；
 * 模型不能直接写，摘要由回合流程在收场时发出，修改由玩家在记忆面板发出
 */
export const memory = defineSystem<MemoryState, never, MemoryInternal>({
  id: "memory",
  dependsOn: ["world"],
  state: MemoryStateSchema,
  initial: () => ({ scenes: [], edits: [] }),
  commands: {},
  internal: {
    "memory.scene": MemorySceneCommandSchema,
    "memory.edit": MemoryEditCommandSchema,
    "memory.log": MemoryLogCommandSchema,
  },
  apply(draft, command, ctx) {
    if (command.type === "memory.edit") return editSceneSummary(draft, command);
    if (command.type === "memory.log") return logMemoryEdit(draft, command, ctx.now);
    return applySceneSummary(draft, command, ctx.now);
  },
});

export * from "./apply";
export * from "./prompt";
export * from "./schema";
