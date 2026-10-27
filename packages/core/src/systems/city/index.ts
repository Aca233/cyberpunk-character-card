import { defineSystem } from "../../kernel/system";
import type { WorldClockState } from "../world";
import { applyBulletin, applyCityEvent, applyRumor } from "./apply";
import { cityRules } from "./prompt";
import {
  CityBulletinCommandSchema,
  CityEventCommandSchema,
  type CityInternal,
  CityRanSchema,
  CityRumorCommandSchema,
  type CityState,
  CityStateSchema,
} from "./schema";
import { citySections } from "./sections";
import { bulletinsView } from "./view";

/** 城里的动静：场外推演写的世界事件，只给模型看；模型不能直接写，由回合流程在收场时推演 */
export const city = defineSystem<CityState, never, CityInternal>({
  id: "city",
  dependsOn: ["world"],
  state: CityStateSchema,
  initial: () => ({
    events: [],
    rumors: [],
    bulletins: [],
    nextBulletin: 1,
    lastScene: null,
    lastAt: null,
    lastContactAt: null,
  }),
  commands: {},
  internal: {
    "city.event": CityEventCommandSchema,
    "city.rumor": CityRumorCommandSchema,
    "city.bulletin": CityBulletinCommandSchema,
    "city.ran": CityRanSchema,
  },
  apply(draft, command, ctx) {
    if (command.type === "city.event") return applyCityEvent(draft, command, ctx.now);
    if (command.type === "city.rumor") return applyRumor(draft, command, ctx.now);
    if (command.type === "city.bulletin") return applyBulletin(draft, command, ctx.now);
    draft.lastScene = ctx.read<WorldClockState>("world").scene;
    draft.lastAt = ctx.now;
    if (command.contact) draft.lastContactAt = ctx.now;
    return { ok: true };
  },
  rules: [cityRules],
  sections: citySections,
  view: { key: "bulletins", project: bulletinsView },
});

export * from "./apply";
export * from "./prompt";
export * from "./schema";
export * from "./sections";
export * from "./view";
