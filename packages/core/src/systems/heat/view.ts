import type { ViewContext } from "../../kernel/system";
import { NpcStateSchema } from "../npc";
import { formatGameTime } from "../world";
import { shownStars } from "./apply";
import { EVENT_LABELS, HEAT_DECAY_MINUTES, HeatStateSchema } from "./schema";

/** 警方热度：整星，另标有没有攒着半星；自然下降还要多久（分钟） */
export function heatView({ world }: ViewContext) {
  // 旧快照里没有热度系统
  const heat = world.slices.heat === undefined ? null : HeatStateSchema.parse(world.slices.heat);
  const npcs = NpcStateSchema.parse(world.slices.npc);
  return {
    stars: shownStars(heat?.stars ?? 0),
    half: (heat?.stars ?? 0) % 1 !== 0,
    lastSeen: heat?.lastSeenAt == null ? null : formatGameTime(heat.lastSeenAt),
    /** 没了结的悬赏：不随时间消失 */
    bounties: (heat?.bounties ?? [])
      .filter((b) => b.resolvedAt === null)
      .map((b) => ({
        id: b.id,
        reward: b.reward,
        reasons: b.reasons,
        hunter: b.hunter,
        hunterName: b.hunter === null ? null : (npcs.npcs[b.hunter]?.name ?? b.hunter),
        since: formatGameTime(b.at),
      })),
    decayIn:
      heat && heat.stars > 0 && heat.decayedAt !== null
        ? Math.max(0, heat.decayedAt + HEAT_DECAY_MINUTES - world.time)
        : null,
    recent: (heat?.recent ?? [])
      .slice(-3)
      .reverse()
      .map((e) => ({
        at: formatGameTime(e.at),
        label: EVENT_LABELS[e.kind],
        delta: e.delta,
        reason: e.reason,
      })),
  };
}
