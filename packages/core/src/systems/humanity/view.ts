import type { ViewContext } from "../../kernel/system";
import { humanityCap, humanityStage, STAGE_LABELS } from "./apply";
import { HUMANITY_MAX, HumanityStateSchema } from "./schema";

/** 玩家可见的人性状态；不暴露结算记录和内部恢复计数 */
export function humanityView({ world }: ViewContext) {
  const humanity = HumanityStateSchema.parse(world.slices.humanity);
  const stage = humanityStage(humanity.current);
  return {
    current: humanity.current,
    cap: humanityCap(humanity),
    max: HUMANITY_MAX,
    stage,
    stageLabel: STAGE_LABELS[stage],
  };
}
