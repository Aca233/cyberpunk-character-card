import { defineSystem } from "../../kernel/system";
import { memoryActions } from "./actions";
import { applySceneSummary, applyWorkingMemory, editSceneSummary, logMemoryEdit } from "./apply";
import {
  MemoryEditCommandSchema,
  type MemoryInternal,
  MemoryLogCommandSchema,
  MemorySceneCommandSchema,
  type MemoryState,
  MemoryStateSchema,
  MemoryWorkingCommandSchema,
} from "./schema";
import { memoryView } from "./view";

/**
 * 剧情记忆：本场提要、持久锚点、收场摘要，和记忆面板的修改记录；
 * 模型提议经过回合流程校验后登记，面板修改由玩家发出。
 */
export const memory = defineSystem<MemoryState, never, MemoryInternal>({
  id: "memory",
  dependsOn: ["world"],
  state: MemoryStateSchema,
  initial: () => ({ scenes: [], edits: [], active: null, pending: {}, anchors: {} }),
  commands: {},
  internal: {
    "memory.scene": MemorySceneCommandSchema,
    "memory.working": MemoryWorkingCommandSchema,
    "memory.edit": MemoryEditCommandSchema,
    "memory.log": MemoryLogCommandSchema,
  },
  apply(draft, command, ctx) {
    if (command.type === "memory.edit") return editSceneSummary(draft, command);
    if (command.type === "memory.log") return logMemoryEdit(draft, command, ctx.now);
    if (command.type === "memory.working") return applyWorkingMemory(draft, command, ctx.now);
    return applySceneSummary(draft, command, ctx.now);
  },
  actions: memoryActions,
  view: { key: "memory", project: memoryView },
});

export * from "./actions";
export * from "./apply";
export * from "./prompt";
export * from "./schema";
export * from "./view";
