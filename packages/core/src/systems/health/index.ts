import { defineSystem } from "../../kernel/system";
import { rulingFact } from "../dice";
import {
  applyCondition,
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
import { healthRules } from "./prompt";
import {
  type DamageCommand,
  DamageCommandSchema,
  type HealCommand,
  HealCommandSchema,
  type HealthConditionCommand,
  HealthConditionCommandSchema,
  type HealthInternal,
  HealthInternalSchemas,
  type HealthState,
  HealthStateSchema,
} from "./schema";
import { healthStatus } from "./status";
import { healthView } from "./view";

export const health = defineSystem<
  HealthState,
  DamageCommand | HealCommand | HealthConditionCommand,
  HealthInternal
>({
  id: "health",
  dependsOn: ["inventory"],
  state: HealthStateSchema,
  initial: () => ({
    condition: "up",
    nextInjuryId: 1,
    painSuppressed: false,
    painSuppressedUntil: null,
    stabilizedBy: null,
    injuries: [],
    lostLimbs: [],
    brokenChrome: [],
  }),
  commands: {
    damage: DamageCommandSchema,
    heal: HealCommandSchema,
    healthCondition: HealthConditionCommandSchema,
  },
  internal: HealthInternalSchemas,
  apply(draft, command, ctx) {
    switch (command.type) {
      case "damage":
        return applyDamage(draft, command, ctx);
      case "heal":
        return applyHeal(draft, command, ctx);
      case "healthCondition":
        return applyCondition(draft, command, ctx);
      case "health.revive":
        return revive(draft, ctx.now, rulingFact(ctx.facts)?.id);
      case "health.die":
        return die(draft, command.reason);
      case "health.limb":
        return applyLimb(draft, command);
      case "health.treat":
        return treatInjury(draft, command.id, ctx.now, rulingFact(ctx.facts)?.id);
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
  rules: [healthRules],
  view: { key: "health", project: healthView },
  status: healthStatus,
  events: healthEvents,
});

export * from "./apply";
export * from "./events";
export * from "./prompt";
export * from "./schema";
export * from "./status";
export * from "./view";
