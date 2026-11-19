import { defineSystem } from "../../kernel/system";
import { applyArc, applyArcOffscreen, applyArcStart, unlockArcs } from "./apply";
import { arcsEvents } from "./events";
import { arcsFeed } from "./feed";
import { arcsObjectives } from "./objectives";
import { arcRules } from "./prompt";
import {
  type ArcCommand,
  ArcCommandSchema,
  ArcOffscreenCommandSchema,
  ArcStartCommandSchema,
  type ArcsInternal,
  type ArcsState,
  ArcsStateSchema,
} from "./schema";
import { arcsSections } from "./sections";
import { arcCardsView } from "./view";

/** 心事（原作人物的个人线）：熟到一定程度他会自己提起，玩家管不管都行，没人管的由场外推演往前推 */
export const arcs = defineSystem<ArcsState, ArcCommand, ArcsInternal>({
  id: "arcs",
  dependsOn: ["npc"],
  state: ArcsStateSchema,
  initial: () => ({ arcs: {} }),
  commands: { arc: ArcCommandSchema },
  internal: { "arc.offscreen": ArcOffscreenCommandSchema, "arc.start": ArcStartCommandSchema },
  apply(draft, command, ctx) {
    switch (command.type) {
      case "arc":
        return applyArc(draft, command, ctx);
      case "arc.offscreen":
        return applyArcOffscreen(draft, command, ctx);
      case "arc.start":
        return applyArcStart(draft, command, ctx);
    }
  },
  tick(draft, span, ctx) {
    unlockArcs(draft, span.to, ctx);
  },
  rules: [arcRules],
  sections: arcsSections,
  objectives: arcsObjectives,
  events: arcsEvents,
  feed: arcsFeed,
  view: { key: "arcCards", project: arcCardsView },
});

export * from "./apply";
export * from "./events";
export * from "./feed";
export * from "./objectives";
export * from "./prompt";
export * from "./schema";
export * from "./sections";
export * from "./view";
