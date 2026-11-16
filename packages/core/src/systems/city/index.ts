import { defineSystem } from "../../kernel/system";
import type { WorldClockState } from "../world";
import { applyBulletin, applyCityEvent, applyRumor, applyRumorHeard } from "./apply";
import { cityFeed } from "./feed";
import { cityRules } from "./prompt";
import {
  CityBulletinCommandSchema,
  CityEventCommandSchema,
  CityFailedSchema,
  type CityInternal,
  CityRanSchema,
  CityRumorCommandSchema,
  type CityState,
  CityStateSchema,
  type RumorHeard,
  RumorHeardSchema,
} from "./schema";
import { citySections } from "./sections";
import { bulletinsView } from "./view";

/** 城里的动静：场外推演写的世界事件，只给模型看；模型不能直接写，由回合流程在收场时推演 */
export const city = defineSystem<CityState, RumorHeard, CityInternal>({
  id: "city",
  dependsOn: ["world"],
  state: CityStateSchema,
  initial: () => ({
    events: [],
    rumors: [],
    nextRumor: 1,
    bulletins: [],
    nextBulletin: 1,
    lastScene: null,
    lastAt: null,
    processedThrough: -1,
    lastAttemptAt: null,
    retryAt: null,
    failures: 0,
  }),
  commands: { rumorHeard: RumorHeardSchema },
  internal: {
    "city.event": CityEventCommandSchema,
    "city.rumor": CityRumorCommandSchema,
    "city.bulletin": CityBulletinCommandSchema,
    "city.ran": CityRanSchema,
    "city.failed": CityFailedSchema,
  },
  apply(draft, command, ctx) {
    if (command.type === "rumorHeard") return applyRumorHeard(draft, command);
    if (command.type === "city.event") return applyCityEvent(draft, command, ctx.now);
    if (command.type === "city.rumor") return applyRumor(draft, command, ctx.now);
    if (command.type === "city.bulletin") return applyBulletin(draft, command, ctx.now);
    draft.lastAttemptAt = ctx.now;
    if (command.type === "city.failed") {
      draft.failures += 1;
      draft.retryAt = ctx.now + Math.min(120, 15 * 2 ** Math.min(3, draft.failures - 1));
      return { ok: true };
    }
    draft.lastScene = ctx.read<WorldClockState>("world").scene;
    draft.lastAt = ctx.now;
    draft.processedThrough = command.through;
    draft.failures = 0;
    draft.retryAt = null;
    return { ok: true };
  },
  rules: [cityRules],
  sections: citySections,
  view: { key: "bulletins", project: bulletinsView },
  feed: cityFeed,
});

export * from "./apply";
export * from "./feed";
export * from "./prompt";
export * from "./schema";
export * from "./sections";
export * from "./view";
