import { defineSystem } from "../../kernel/system";
import { locationForTravel, WorldClockStateSchema } from "../world";
import { travelActions } from "./actions";
import { applyTravel, clearEncounter } from "./apply";
import { travelRules } from "./prompt";
import {
  type TravelCommand,
  TravelCommandSchema,
  type TravelState,
  TravelStateSchema,
  VEHICLE_CLASS_LABELS,
  VEHICLE_CONDITION_LABELS,
  type VehicleCommand,
  VehicleCommandSchema,
  type VehicleGrant,
  VehicleGrantSchema,
  type VehicleSummon,
  VehicleSummonSchema,
} from "./schema";
import { travelStatus } from "./status";
import { applyVehicle, grantVehicle, summonVehicle, vehicleCatalog } from "./vehicles";
import { travelView } from "./view";

const VEHICLE_CONTEXT = /车|摩托|开|驾驶|骑|追|逃|甩|停|抛|弃|丢|拿|取|放|留|修|偷|后备箱/;

/** 出行和载具：路线面板确认的移动按路线表推进时间、扣路费、换地点，换城区时按几率定路上的偶遇；名下的车、偷车、追车 */
export const travel = defineSystem<
  TravelState,
  VehicleCommand,
  TravelCommand | VehicleGrant | VehicleSummon
>({
  id: "travel",
  dependsOn: [
    "world",
    "economy",
    "heat",
    "character",
    "combat",
    "inventory",
    "cyberware",
    "factions",
    "ncpd",
    "npc",
  ],
  state: TravelStateSchema,
  initial: () => ({
    trips: [],
    encounterScene: null,
    encounter: null,
    vehicles: [],
    nextVehicleId: 1,
  }),
  commands: { vehicle: VehicleCommandSchema },
  internal: {
    travel: TravelCommandSchema,
    "vehicle.grant": VehicleGrantSchema,
    "vehicle.summon": VehicleSummonSchema,
  },
  apply(draft, command, ctx) {
    switch (command.type) {
      case "travel":
        return applyTravel(draft, command, ctx);
      case "vehicle.grant":
        return grantVehicle(draft, command, ctx);
      case "vehicle.summon":
        return summonVehicle(draft, command, ctx);
      case "vehicle":
        return applyVehicle(draft, command, ctx);
    }
  },
  actions: travelActions,
  on: {
    "scene.end": (draft) => clearEncounter(draft),
  },
  rules: [travelRules],
  sections: [
    {
      order: 74,
      title: "停在别处或已弃置的车辆",
      render: ({ world, data, input }) => {
        const travelState = TravelStateSchema.parse(world.slices.travel);
        const here = WorldClockStateSchema.parse(world.slices.world).location;
        const catalog = vehicleCatalog(data ?? {});
        const text = input.text;
        const related = travelState.vehicles.filter((v) => {
          const def = catalog.get(v.model);
          const name = def?.name ?? v.model;
          const mentioned = text.includes(v.id) || text.includes(name);
          if (v.abandoned) return mentioned || (here !== null && v.location === here);
          if (here !== null && v.location === here) return false;
          return mentioned || VEHICLE_CONTEXT.test(text);
        });
        if (related.length === 0) return undefined;
        return related
          .map((v) => {
            const def = catalog.get(v.model);
            const name = def?.name ?? v.model;
            const loc =
              v.location === null
                ? "位置未知"
                : (locationForTravel(data ?? {}, v.location)?.name ?? v.location);
            const flags = [
              def ? VEHICLE_CLASS_LABELS[def.class] : null,
              v.condition !== "intact" ? VEHICLE_CONDITION_LABELS[v.condition] : null,
              v.stolen ? "偷来的" : null,
              v.abandoned ? "已弃置" : null,
            ].filter((x): x is string => x !== null);
            return `- ${v.id}「${name}」（${flags.join("，")}）：停在 ${loc}`;
          })
          .join("\n");
      },
    },
  ],
  view: { key: "travel", project: travelView },
  status: travelStatus,
});

export * from "./actions";
export * from "./apply";
export * from "./prompt";
export * from "./schema";
export * from "./status";
export * from "./vehicles";
export * from "./view";
