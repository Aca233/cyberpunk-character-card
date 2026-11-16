import { defineSystem } from "../../kernel/system";
import { applyDeadline, applyWorld, endScene } from "./apply";
import { worldEvents } from "./events";
import { worldFeed } from "./feed";
import { placeRules, placeSections, withPlaces } from "./places";
import {
  type DeadlineCommand,
  DeadlineCommandSchema,
  type EndScene,
  EndSceneSchema,
  type WorldClockState,
  WorldClockStateSchema,
  type WorldCommand,
  WorldCommandSchema,
} from "./schema";
import { worldStatus } from "./status";
import { worldView } from "./view";

export const world = defineSystem<WorldClockState, WorldCommand | DeadlineCommand, EndScene>({
  id: "world",
  state: WorldClockStateSchema,
  initial: () => ({
    location: null,
    deadlines: [],
    scene: 0,
    sceneStartedAt: 0,
    places: [],
    phasesAwake: 0,
    blackLaceDoses: [],
    blackLaceActiveUntil: null,
  }),
  commands: {
    world: WorldCommandSchema,
    deadline: DeadlineCommandSchema,
  },
  internal: { "world.endScene": EndSceneSchema },
  apply(draft, command, ctx) {
    switch (command.type) {
      case "world":
        return applyWorld(draft, command, ctx.now, ctx.data);
      case "deadline":
        return applyDeadline(draft, command, ctx.now);
      case "world.endScene":
        return endScene(draft, ctx.now);
    }
  },
  // 统一的地点表（用户定的，2026-11-01："统一为地点"）：存档里记下的地点并进地点表和周边锚点，别的系统照旧用 locationCatalog 查
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
export * from "./merchant-sites";
export * from "./places";
export * from "./radar";
export * from "./schema";
export * from "./status";
export * from "./view";
export * from "./weather";
