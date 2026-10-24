import { defineSystem } from "../../kernel/system";
import { applyTravel, clearEncounter } from "./apply";
import { travelRules } from "./prompt";
import {
  type TravelCommand,
  TravelCommandSchema,
  type TravelState,
  TravelStateSchema,
} from "./schema";

/** 出行：路线面板确认的移动按路线表推进时间、扣路费、换地点，换城区时按几率定路上的偶遇 */
export const travel = defineSystem<TravelState, never, TravelCommand>({
  id: "travel",
  dependsOn: ["world", "economy", "heat", "character", "combat"],
  state: TravelStateSchema,
  initial: () => ({ trips: [], encounterScene: null, encounter: null }),
  commands: {},
  internal: { travel: TravelCommandSchema },
  apply: (draft, command, ctx) => applyTravel(draft, command, ctx),
  on: {
    "scene.end": (draft) => clearEncounter(draft),
  },
  rules: [travelRules],
});

export * from "./apply";
export * from "./prompt";
export * from "./schema";
