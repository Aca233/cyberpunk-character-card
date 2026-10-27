import type { Threat, ViewContext } from "../../kernel/system";
import { HeatStateSchema } from "./schema";

/** 警方交的威胁：整星的热度一条，没了结的悬赏各一条；有赏金猎人登场的算正在追杀 */
export function heatThreats({ world }: ViewContext): readonly Threat[] {
  const state = HeatStateSchema.parse(world.slices.heat);
  const result: Threat[] = [];
  const stars = Math.floor(state.stars);
  if (stars > 0) {
    const last = state.recent.findLast((e) => e.delta > 0);
    result.push({
      id: "heat:ncpd",
      source: "heat",
      sourceLabel: "NCPD",
      who: "NCPD",
      level: stars,
      reason: last ? `警方热度 ${stars} 星，最近一件：${last.reason}` : `警方热度 ${stars} 星`,
    });
  }
  for (const b of state.bounties) {
    if (b.resolvedAt !== null) continue;
    result.push({
      id: `heat:bounty:${b.id}`,
      source: "heat",
      sourceLabel: "悬赏",
      who: b.hunter === null ? "悬赏" : "赏金猎人",
      level: b.hunter === null ? 4 : 5,
      reason: `悬赏 ${b.reward} 欧元${b.reasons.length > 0 ? `：${b.reasons.join("；")}` : ""}${b.hunter === null ? "" : "，赏金猎人已经找上来了"}`,
    });
  }
  return result;
}
