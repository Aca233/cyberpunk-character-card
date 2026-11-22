import { defineSystem } from "../../kernel/system";
import {
  applyDamage,
  applyHeal,
  applyHit,
  applyLimb,
  die,
  recoverInjuries,
  revive,
  treatInjury,
} from "./apply";
import { healthEvents } from "./events";
import {
  type DamageCommand,
  DamageCommandSchema,
  type HealCommand,
  HealCommandSchema,
  type HealthInternal,
  HealthInternalSchemas,
  type HealthState,
  HealthStateSchema,
} from "./schema";
import { healthStatus } from "./status";
import { healthView } from "./view";

export const health = defineSystem<HealthState, DamageCommand | HealCommand, HealthInternal>({
  id: "health",
  dependsOn: ["inventory"],
  state: HealthStateSchema,
  initial: () => ({
    condition: "up",
    nextInjuryId: 1,
    painSuppressed: false,
    painSuppressedUntil: null,
    damagedBy: null,
    injuries: [],
    lostLimbs: [],
    brokenChrome: [],
  }),
  commands: { damage: DamageCommandSchema, heal: HealCommandSchema },
  internal: HealthInternalSchemas,
  apply(draft, command, ctx) {
    switch (command.type) {
      case "damage":
        return applyDamage(draft, command, ctx);
      case "heal":
        return applyHeal(draft, command, ctx);
      case "health.revive":
        return revive(draft, ctx.now);
      case "health.die":
        return die(draft, command.reason);
      case "health.limb":
        return applyLimb(draft, command);
      case "health.treat":
        return treatInjury(draft, command.id, ctx.now);
      case "health.hit":
        return applyHit(draft, command, ctx);
    }
  },
  on: {
    "trade.medical": (draft, ctx) => {
      applyHeal(draft, { type: "heal", source: "ripperdoc" }, ctx);
    },
  },
  tick: (draft, span) => recoverInjuries(draft, span),
  view: { key: "health", project: healthView },
  status: healthStatus,
  events: healthEvents,
});

export * from "./apply";
export * from "./events";
export * from "./schema";
export * from "./status";
export * from "./view";
