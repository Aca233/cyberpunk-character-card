import { defineSystem } from "../../kernel/system";
import { applyDeadline, applyWorld, endScene } from "./apply";
import { worldEvents } from "./events";
import { worldFeed } from "./feed";
import { applyPlace, placeRules, placeSections, withPlaces } from "./places";
import {
  type DeadlineCommand,
  DeadlineCommandSchema,
  type EndScene,
  EndSceneSchema,
  type PlaceCommand,
  PlaceCommandSchema,
  type WorldClockState,
  WorldClockStateSchema,
  type WorldCommand,
  WorldCommandSchema,
} from "./schema";
import { worldStatus } from "./status";
import { worldView } from "./view";

export const world = defineSystem<
  WorldClockState,
  WorldCommand | DeadlineCommand | PlaceCommand,
  EndScene
>({
  id: "world",
  state: WorldClockStateSchema,
  initial: () => ({ location: null, deadlines: [], scene: 0, sceneStartedAt: 0, places: [] }),
  commands: {
    world: WorldCommandSchema,
    deadline: DeadlineCommandSchema,
    place: PlaceCommandSchema,
  },
  internal: { "world.endScene": EndSceneSchema },
  apply(draft, command, ctx) {
    switch (command.type) {
      case "world":
        return applyWorld(draft, command, ctx.now, ctx.data);
      case "deadline":
        return applyDeadline(draft, command, ctx.now);
      case "place":
        return applyPlace(draft, command, ctx.data, ctx.now);
      case "world.endScene":
        return endScene(draft, ctx.now);
    }
  },
  // 地点簿并进地点表和周边锚点（places-plan §四），别的系统照旧用 locationCatalog 查
  data: (state, data) => withPlaces(data, state.places),
  rules: [placeRules],
  sections: placeSections,
  view: { key: "clock", project: worldView },
  status: worldStatus,
  events: worldEvents,
  feed: worldFeed,
});

export * from "./apply";
export * from "./district";
export * from "./events";
export * from "./feed";
export * from "./places";
export * from "./prompt";
export * from "./radar";
export * from "./schema";
export * from "./status";
export * from "./view";
export * from "./weather";
