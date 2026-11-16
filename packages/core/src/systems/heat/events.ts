import type { EventContext, SystemEvent } from "../../kernel/system";
import { shownStars } from "./apply";
import { HeatStateSchema } from "./schema";

/** 悬赏新挂、涨价、了结与通缉星级上升；不读取赏金猎人的隐藏资料 */
export function heatEvents({ before, after }: EventContext): readonly SystemEvent[] {
  const prevState = HeatStateSchema.parse(before.world.slices.heat);
  const nextState = HeatStateSchema.parse(after.world.slices.heat);
  const was = prevState.bounties.filter((b) => b.resolvedAt === null);
  const now = nextState.bounties.filter((b) => b.resolvedAt === null);
  const result: SystemEvent[] = [];
  const prevStars = shownStars(prevState.stars);
  const nextStars = shownStars(nextState.stars);
  if (nextStars > prevStars) {
    result.push({
      source: "heat",
      icon: "warning",
      text: `通缉等级上升：${prevStars} → ${nextStars} 星`,
      tone: "bad",
    });
  }
  for (const b of now) {
    const old = was.find((p) => p.id === b.id);
    if (old && old.reward === b.reward) continue;
    result.push({
      source: "heat",
      icon: "warning",
      text: `${old ? "悬赏变为" : "你被挂了悬赏"}：${b.reward.toLocaleString("en-US")} 欧元`,
      tone: old && b.reward < old.reward ? "good" : "bad",
    });
  }
  for (const b of was) {
    if (!now.some((n) => n.id === b.id)) {
      result.push({
        source: "heat",
        icon: "attention",
        text: "悬赏了结了",
        tone: "good",
      });
    }
  }
  return result;
}
