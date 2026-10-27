import type { ViewContext } from "../../kernel/system";
import { NpcStateSchema } from "../npc";
import { formatGameTime } from "../world";
import { IMPORTANCE_LABELS, MemoryStateSchema } from "./schema";

/** 记忆面板显示最近几条修改记录 */
export const MEMORY_EDITS_SHOWN = 20;

/** 记忆面板：场景摘要（新的在前）和最近的修改记录；共同记忆在 npcs 里 */
export function memoryView({ world }: ViewContext) {
  const m = MemoryStateSchema.parse(world.slices.memory ?? {});
  const npcs = NpcStateSchema.parse(world.slices.npc);
  return {
    scenes: [...m.scenes].reverse().map((s) => ({
      scene: s.scene,
      at: formatGameTime(s.at),
      title: s.title,
      text: s.text,
      importance: s.importance,
      importanceLabel: IMPORTANCE_LABELS[s.importance],
      people: s.people.map((id) => npcs.npcs[id]?.name ?? id),
      edited: s.edited === true,
    })),
    edits: [...m.edits]
      .reverse()
      .slice(0, MEMORY_EDITS_SHOWN)
      .map((e) => ({
        at: formatGameTime(e.at),
        what: e.what === "scene" ? "场景摘要" : "共同记忆",
        ref: e.ref,
        action: e.action === "edit" ? "改写" : "删掉",
        before: e.before,
        after: e.after,
      })),
  };
}
