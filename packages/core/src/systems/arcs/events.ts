import type { EventContext, SystemEvent, ViewContext } from "../../kernel/system";
import { NpcStateSchema } from "../npc";
import { arcCatalog } from "./apply";
import { ArcsStateSchema, type ConcernStatus } from "./schema";

/** 玩家知道的心事状态：场外暗中出的结局在听说之前按结局之前的状态算 */
function knownStatuses({ world, data }: ViewContext): Map<string, ConcernStatus> {
  const state = ArcsStateSchema.parse(world.slices.arcs ?? {});
  const result = new Map<string, ConcernStatus>();
  for (const seed of arcCatalog(data).values()) {
    for (const concern of seed.concerns) {
      const p = state.arcs[seed.npc]?.concerns[concern.id];
      if (!p) continue;
      const status = p.outcome?.known
        ? "resolved"
        : p.outcome
          ? (p.outcome.previousStatus ?? null)
          : p.status;
      if (status !== null) result.set(`${seed.npc}:${concern.id}`, status);
    }
  }
  return result;
}

/** 心事交的系统通知：刚说出口的、听说有了结果的；走向、原作结局和暗中的结果不进来 */
export function arcsEvents({ before, after }: EventContext): readonly SystemEvent[] {
  const was = knownStatuses(before);
  const now = knownStatuses(after);
  const npcs = NpcStateSchema.parse(after.world.slices.npc).npcs;
  const result: SystemEvent[] = [];
  for (const seed of arcCatalog(after.data).values()) {
    const name = npcs[seed.npc]?.name ?? seed.npc;
    for (const concern of seed.concerns) {
      const key = `${seed.npc}:${concern.id}`;
      const status = now.get(key);
      const old = was.get(key);
      if (status === undefined || status === old) continue;
      if (status === "resolved") {
        result.push({
          source: "arcs",
          icon: "questUpdate",
          text: `${name}的事有了结果：${concern.title}`,
          tone: "info",
        });
      } else if (old === undefined) {
        result.push({
          source: "arcs",
          icon: "journal",
          text: `${name}跟你说起：${concern.title}`,
          tone: "info",
        });
      }
    }
  }
  return result;
}
