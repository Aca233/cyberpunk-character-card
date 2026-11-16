import type { Draft } from "immer";
import type { ApplyOutcome } from "../../kernel/system";
import {
  MEMORY_EDITS_KEPT,
  MEMORY_KEPT,
  type MemoryEditCommand,
  type MemoryLogCommand,
  type MemorySceneCommand,
  type MemoryState,
  type MemoryWorkingCommand,
} from "./schema";

/** 按场次合并：同一场整条替换，其余按场次排好；超出上限删最早的 */
export function applySceneSummary(
  draft: Draft<MemoryState>,
  command: MemorySceneCommand,
  now: number,
): ApplyOutcome {
  if (draft.corrections[String(command.scene)])
    return { ok: false, reason: "该场记忆已由玩家修正，模型不能用旧来源覆盖" };
  const { type: _type, ...fields } = command;
  const entry = { ...fields, at: now };
  const old = draft.scenes.findIndex((s) => s.scene === entry.scene);
  if (old >= 0) draft.scenes[old] = entry;
  else draft.scenes.push(entry);
  draft.scenes.sort((a, b) => a.scene - b.scene);
  while (draft.scenes.length > MEMORY_KEPT) draft.scenes.shift();
  if (draft.active?.scene === command.scene) draft.active = null;
  delete draft.pending[String(command.scene)];
  return { ok: true };
}

/** 未提及的锚点保留；同一 id 不允许被后续滚动提要改写成别的事实。 */
export function applyWorkingMemory(
  draft: Draft<MemoryState>,
  command: MemoryWorkingCommand,
  now: number,
): ApplyOutcome {
  const additions = new Map(command.anchors.map((anchor) => [anchor.id, anchor]));
  if (additions.size !== command.anchors.length) return { ok: false, reason: "场景锚点 id 重复" };
  for (const anchor of command.anchors) {
    const old = draft.anchors[anchor.id];
    if (old && (old.text !== anchor.text || old.kind !== anchor.kind))
      return { ok: false, reason: `记忆锚点 ${anchor.id} 已存在，不能改写原事实` };
  }
  const resolved = new Set<string>();
  for (const resolution of command.resolve) {
    if (resolved.has(resolution.id)) return { ok: false, reason: "记忆锚点重复给出结果" };
    resolved.add(resolution.id);
    const anchor = draft.anchors[resolution.id];
    if (!anchor) return { ok: false, reason: `没有记忆锚点 ${resolution.id}` };
    if (anchor.kind === "fact" || anchor.kind === "report")
      return { ok: false, reason: "事实和待核实说法不能当作待办勾销" };
    if (anchor.resolution !== null)
      return { ok: false, reason: `记忆锚点 ${resolution.id} 已经有了结果` };
    if (resolution.outcome === "answered" && anchor.kind !== "question")
      return { ok: false, reason: "只有待解问题可以记录答案" };
    if (resolution.outcome === "fulfilled" && anchor.kind === "question")
      return { ok: false, reason: "待解问题应记录答案，不能当作承诺兑现" };
  }
  if (draft.active && draft.active.scene !== command.scene)
    draft.pending[String(draft.active.scene)] = draft.active;
  draft.active = { scene: command.scene, place: command.place, text: command.text, at: now };
  for (const anchor of command.anchors) {
    if (draft.anchors[anchor.id]) continue;
    draft.anchors[anchor.id] = {
      ...anchor,
      scene: command.scene,
      place: command.place,
      at: now,
      resolution: null,
    };
  }
  for (const { id, ...resolution } of command.resolve) {
    const anchor = draft.anchors[id];
    if (anchor) anchor.resolution = { ...resolution, at: now, scene: command.scene };
  }
  return { ok: true };
}

/** 记忆面板：改写或删掉一条场景摘要；正文和玩家看到的对不上就不改 */
export function editSceneSummary(
  draft: Draft<MemoryState>,
  command: MemoryEditCommand,
  now: number,
  sourceThrough: unknown,
): ApplyOutcome {
  const i = draft.scenes.findIndex((s) => s.scene === command.scene);
  const scene = draft.scenes[i];
  if (!scene) return { ok: false, reason: `没有第 ${command.scene} 场的摘要` };
  if (scene.text !== command.before) {
    return { ok: false, reason: `第 ${command.scene} 场的摘要已经变了，刷新后再改` };
  }
  const invalidating =
    command.action === "remove" || (command.text !== undefined && command.text !== scene.text);
  if (
    invalidating &&
    (typeof sourceThrough !== "number" || !Number.isInteger(sourceThrough) || sourceThrough < -1)
  )
    return { ok: false, reason: "记忆纠错缺少来源截止位置，未修改" };
  if (command.action === "remove") {
    invalidateSceneSources(draft, command.scene, "remove", now, sourceThrough as number);
    draft.scenes.splice(i, 1);
    return { ok: true, notes: [`删掉了第 ${command.scene} 场的摘要`] };
  }
  const title = command.title ?? scene.title;
  const text = command.text ?? scene.text;
  const importance = command.importance ?? scene.importance;
  if (title === scene.title && text === scene.text && importance === scene.importance) {
    return { ok: false, reason: "内容没变" };
  }
  // 只改标题/重要度不否定原事实；正文纠错使同场派生来源失效。
  if (text !== scene.text)
    invalidateSceneSources(draft, command.scene, "edit", now, sourceThrough as number);
  scene.title = title;
  scene.text = text;
  scene.importance = importance;
  scene.edited = true;
  return { ok: true, notes: [`改写了第 ${command.scene} 场的摘要`] };
}

/** 场景是当前可定位的最小共同来源；不删除原始日志，也不影响别场锚点。 */
function invalidateSceneSources(
  draft: Draft<MemoryState>,
  scene: number,
  action: "edit" | "remove",
  now: number,
  through: number,
): void {
  draft.corrections[String(scene)] = { at: now, action, through };
  if (draft.active?.scene === scene) draft.active = null;
  delete draft.pending[String(scene)];
  for (const [id, anchor] of Object.entries(draft.anchors)) {
    if (anchor.scene === scene) delete draft.anchors[id];
    else if (anchor.resolution?.scene === scene) anchor.resolution = null;
  }
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
