import { defineSystem } from "../../kernel/system";
import { applyDeadline, applyWorld, endScene } from "./apply";
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
import { worldView } from "./view";

export const world = defineSystem<WorldClockState, WorldCommand | DeadlineCommand, EndScene>({
  id: "world",
  state: WorldClockStateSchema,
  initial: () => ({ location: null, deadlines: [], scene: 0, sceneStartedAt: 0 }),
  commands: { world: WorldCommandSchema, deadline: DeadlineCommandSchema },
  internal: { "world.endScene": EndSceneSchema },
  apply(draft, command, ctx) {
    switch (command.type) {
      case "world":
        return applyWorld(draft, command, ctx.now);
      case "deadline":
        return applyDeadline(draft, command, ctx.now);
      case "world.endScene":
        return endScene(draft, ctx.now);
    }
  },
  view: { key: "clock", project: worldView },
});

export * from "./apply";
export * from "./district";
export * from "./schema";
export * from "./view";
export * from "./weather";
