import { defineSystem } from "../../kernel/system";
import { applyArc, applyArcOffscreen, unlockArcs } from "./apply";
import { arcRules } from "./prompt";
import {
  type ArcCommand,
  ArcCommandSchema,
  ArcOffscreenCommandSchema,
  type ArcsInternal,
  type ArcsState,
  ArcsStateSchema,
} from "./schema";

/** 心事（原作人物的个人线）：熟到一定程度他会自己提起，玩家管不管都行，没人管的由场外推演往前推 */
export const arcs = defineSystem<ArcsState, ArcCommand, ArcsInternal>({
  id: "arcs",
  dependsOn: ["npc"],
  state: ArcsStateSchema,
  initial: () => ({ arcs: {} }),
  commands: { arc: ArcCommandSchema },
  internal: { "arc.offscreen": ArcOffscreenCommandSchema },
  apply(draft, command, ctx) {
    switch (command.type) {
      case "arc":
        return applyArc(draft, command, ctx);
      case "arc.offscreen":
        return applyArcOffscreen(draft, command, ctx);
    }
  },
  tick(draft, span, ctx) {
    unlockArcs(draft, span.to, ctx);
  },
  rules: [arcRules],
});

export * from "./apply";
export * from "./prompt";
export * from "./schema";
