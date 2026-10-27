import type { Threat, ViewContext } from "../../kernel/system";
import { NEMESIS_STYLE_LABELS, NemesisStateSchema } from "./schema";

/**
 * 宿敌交的威胁：每个还没了结的宿敌一条；屏幕外的动静不进来，
 * 准备只有玩家打听到了才写、才抬等级，免得没揭露的准备从等级上露出来
 */
export function nemesisThreats({ world }: ViewContext): readonly Threat[] {
  const state = NemesisStateSchema.parse(world.slices.nemesis ?? {});
  return state.nemeses.map((n) => {
    const prep = n.known ? n.prep : null;
    return {
      id: `nemesis:${n.npc}`,
      source: "nemesis",
      sourceLabel: "宿敌",
      who: n.name,
      level: prep ? 4 : 3,
      reason: prep
        ? `${n.how}；针对你的${NEMESIS_STYLE_LABELS[prep.against]}做了准备：${prep.text}`
        : n.how,
    };
  });
}
