import { defineSystem } from "../../kernel/system";
import type { WorldClockState } from "../world";
import { applyCityEvent } from "./apply";
import { cityRules } from "./prompt";
import {
  CityEventCommandSchema,
  type CityInternal,
  CityRanSchema,
  type CityState,
  CityStateSchema,
} from "./schema";

/** 城里的动静：场外推演写的世界事件，只给模型看；模型不能直接写，由回合流程在收场时推演 */
export const city = defineSystem<CityState, never, CityInternal>({
  id: "city",
  dependsOn: ["world"],
  state: CityStateSchema,
  initial: () => ({ events: [], lastScene: null, lastAt: null }),
  commands: {},
  internal: {
    "city.event": CityEventCommandSchema,
    "city.ran": CityRanSchema,
  },
  apply(draft, command, ctx) {
    if (command.type === "city.event") return applyCityEvent(draft, command, ctx.now);
    draft.lastScene = ctx.read<WorldClockState>("world").scene;
    draft.lastAt = ctx.now;
    return { ok: true };
  },
  rules: [cityRules],
});

export * from "./apply";
export * from "./prompt";
export * from "./schema";
