import type { EventContext, SystemEvent } from "../../kernel/system";
import { HeatStateSchema } from "./schema";

/** 悬赏新挂、涨价和了结；不读取赏金猎人的隐藏资料 */
export function heatEvents({ before, after }: EventContext): readonly SystemEvent[] {
  const was = HeatStateSchema.parse(before.world.slices.heat).bounties.filter(
    (b) => b.resolvedAt === null,
  );
  const now = HeatStateSchema.parse(after.world.slices.heat).bounties.filter(
    (b) => b.resolvedAt === null,
  );
  const result: SystemEvent[] = [];
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
