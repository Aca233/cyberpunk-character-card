import type { Draft } from "immer";
import type { ApplyOutcome } from "../../kernel/system";
import { MEMORY_KEPT, type MemorySceneCommand, type MemoryState } from "./schema";

/** 按场次合并：同一场整条替换，其余按场次排好；超出上限删最早的 */
export function applySceneSummary(
  draft: Draft<MemoryState>,
  command: MemorySceneCommand,
  now: number,
): ApplyOutcome {
  const { type: _type, ...fields } = command;
  const entry = { ...fields, at: now };
  const old = draft.scenes.findIndex((s) => s.scene === entry.scene);
  if (old >= 0) draft.scenes[old] = entry;
  else draft.scenes.push(entry);
  draft.scenes.sort((a, b) => a.scene - b.scene);
  while (draft.scenes.length > MEMORY_KEPT) draft.scenes.shift();
  return { ok: true };
}
