import type { ViewContext } from "../../kernel/system";
import { isImmunosuppressed, neuralDisplay, neuralStage, STAGE_LABELS } from "./apply";
import { HUMANITY_MAX, HumanityStateSchema, TOLERANCE_EFFECTS, TOLERANCE_LABELS } from "./schema";

/** 投影保留面板的状态条形状；直接反映已确认症状严重度与定性神经耐受。 */
export function humanityView({ world }: ViewContext) {
  const state = HumanityStateSchema.parse(world.slices.humanity);
  const stage = neuralStage(state);
  const suppressed = isImmunosuppressed(state, world.time);
  return {
    current: neuralDisplay(state),
    cap: HUMANITY_MAX,
    max: HUMANITY_MAX,
    tolerance: state.tolerance,
    toleranceLabel: TOLERANCE_LABELS[state.tolerance],
    toleranceEffect: TOLERANCE_EFFECTS[state.tolerance],
    stage,
    stageLabel: STAGE_LABELS[stage],
    suppressed,
    symptoms: state.symptoms,
    glitchZone: !suppressed && ["unstable", "edge", "crisis"].includes(stage),
  };
}
