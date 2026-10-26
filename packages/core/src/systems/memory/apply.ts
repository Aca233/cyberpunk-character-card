import type { Draft } from "immer";
import type { ApplyOutcome } from "../../kernel/system";
import {
  MEMORY_EDITS_KEPT,
  MEMORY_KEPT,
  type MemoryEditCommand,
  type MemoryLogCommand,
  type MemorySceneCommand,
  type MemoryState,
} from "./schema";

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

/** 记忆面板：改写或删掉一条场景摘要；正文和玩家看到的对不上就不改 */
export function editSceneSummary(
  draft: Draft<MemoryState>,
  command: MemoryEditCommand,
): ApplyOutcome {
  const i = draft.scenes.findIndex((s) => s.scene === command.scene);
  const scene = draft.scenes[i];
  if (!scene) return { ok: false, reason: `没有第 ${command.scene} 场的摘要` };
  if (scene.text !== command.before) {
    return { ok: false, reason: `第 ${command.scene} 场的摘要已经变了，刷新后再改` };
  }
  if (command.action === "remove") {
    draft.scenes.splice(i, 1);
    return { ok: true, notes: [`删掉了第 ${command.scene} 场的摘要`] };
  }
  const title = command.title ?? scene.title;
  const text = command.text ?? scene.text;
  const importance = command.importance ?? scene.importance;
  if (title === scene.title && text === scene.text && importance === scene.importance) {
    return { ok: false, reason: "内容没变" };
  }
  scene.title = title;
  scene.text = text;
  scene.importance = importance;
  scene.edited = true;
  return { ok: true, notes: [`改写了第 ${command.scene} 场的摘要`] };
}

/** 记一条修改记录；超出上限删最早的 */
export function logMemoryEdit(
  draft: Draft<MemoryState>,
  command: MemoryLogCommand,
  now: number,
): ApplyOutcome {
  const { type: _type, ...fields } = command;
  draft.edits.push({ ...fields, at: now });
  while (draft.edits.length > MEMORY_EDITS_KEPT) draft.edits.shift();
  return { ok: true };
}
