import type { ViewContext } from "../../kernel/system";
import {
  humanityCap,
  humanityStage,
  isGlitchZone,
  isImmunosuppressed,
  STAGE_LABELS,
} from "./apply";
import { HUMANITY_MAX, HumanityStateSchema } from "./schema";

/** 玩家可见的人性状态（含神经负荷上限、免疫抑制剂状态与感知失真提示） */
export function humanityView({ world }: ViewContext) {
  const humanity = HumanityStateSchema.parse(world.slices.humanity);
  const stage = humanityStage(humanity.current);
  const suppressed = isImmunosuppressed(humanity, world.time);
  return {
    current: humanity.current,
    cap: humanityCap(humanity),
    max: HUMANITY_MAX,
    stage,
    stageLabel: STAGE_LABELS[stage],
    suppressed,
    glitchZone: isGlitchZone(humanity.current, suppressed),
  };
}
