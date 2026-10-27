import { defineSystem } from "../../kernel/system";
import { applyTravel, clearEncounter } from "./apply";
import { travelRules } from "./prompt";
import {
  type TravelCommand,
  TravelCommandSchema,
  type TravelState,
  TravelStateSchema,
  type VehicleCommand,
  VehicleCommandSchema,
  type VehicleGrant,
  VehicleGrantSchema,
} from "./schema";
import { travelStatus } from "./status";
import { applyVehicle, grantVehicle } from "./vehicles";
import { travelView } from "./view";

/** 出行和载具：路线面板确认的移动按路线表推进时间、扣路费、换地点，换城区时按几率定路上的偶遇；名下的车、偷车、追车 */
export const travel = defineSystem<TravelState, VehicleCommand, TravelCommand | VehicleGrant>({
  id: "travel",
  dependsOn: ["world", "economy", "heat", "character", "combat"],
  state: TravelStateSchema,
  initial: () => ({ trips: [], encounterScene: null, encounter: null, vehicles: [] }),
  commands: { vehicle: VehicleCommandSchema },
  internal: { travel: TravelCommandSchema, "vehicle.grant": VehicleGrantSchema },
  apply(draft, command, ctx) {
    switch (command.type) {
      case "travel":
        return applyTravel(draft, command, ctx);
      case "vehicle.grant":
        return grantVehicle(draft, command, ctx);
      case "vehicle":
        return applyVehicle(draft, command, ctx);
    }
  },
  on: {
    "scene.end": (draft) => clearEncounter(draft),
  },
  rules: [travelRules],
  view: { key: "travel", project: travelView },
  status: travelStatus,
});

export * from "./apply";
export * from "./prompt";
export * from "./schema";
export * from "./status";
export * from "./vehicles";
export * from "./view";
