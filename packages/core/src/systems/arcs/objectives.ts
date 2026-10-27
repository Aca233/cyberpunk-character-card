import type { Objective, ViewContext } from "../../kernel/system";
import { NpcStateSchema } from "../npc";
import { arcCatalog } from "./apply";
import { ArcsStateSchema, CONCERN_STATUS_LABELS } from "./schema";

/** 只列说出口、尚未拒绝或了结的心事；未公开的场外结局不改变待办 */
export function arcsObjectives({ world, data }: ViewContext): readonly Objective[] {
  const state = ArcsStateSchema.parse(world.slices.arcs ?? {});
  const npcs = NpcStateSchema.parse(world.slices.npc).npcs;
  const result: Objective[] = [];
  for (const seed of arcCatalog(data).values()) {
    for (const concern of seed.concerns) {
      const p = state.arcs[seed.npc]?.concerns[concern.id];
      if (!p) continue;
      const status = p.outcome && !p.outcome.known ? p.outcome.previousStatus : p.status;
      if (status !== "told" && status !== "involved") continue;
      result.push({
        id: `arcs:${seed.npc}:${concern.id}`,
        source: "arcs",
        sourceLabel: "心事",
        title: `${npcs[seed.npc]?.name ?? seed.npc}：${concern.title}`,
        location: null,
        due: null,
        dueIn: null,
        progress: p.notes.findLast((n) => n.by === "scene")?.text ?? CONCERN_STATUS_LABELS[status],
        status: status === "involved" ? "active" : "offered",
      });
    }
  }
  return result;
}
