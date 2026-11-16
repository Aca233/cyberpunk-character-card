import { defineSystem } from "../../kernel/system";
import { maxHp } from "../dice";
import { applyDamage, applyHeal, applyHit, applyLimb, bleed, die, revive, setMax } from "./apply";
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
  dependsOn: ["dice", "inventory"],
  state: HealthStateSchema,
  initial: () => {
    const max = maxHp(3, 0);
    return {
      hp: max,
      max,
      condition: "up",
      wounds: 0,
      painSuppressed: false,
      severeSince: null,
      bleeds: 0,
      damagedBy: null,
      injuries: [],
      lostLimbs: [],
      brokenChrome: [],
    };
  },
  commands: { damage: DamageCommandSchema, heal: HealCommandSchema },
  internal: HealthInternalSchemas,
  apply(draft, command, ctx) {
    switch (command.type) {
      case "damage":
        return applyDamage(draft, command, ctx);
      case "heal":
        return applyHeal(draft, command, ctx);
      case "health.setMax":
        return setMax(draft, command.max, ctx.now);
      case "health.revive":
        return revive(draft, ctx.now);
      case "health.die":
        return die(draft, command.reason);
      case "health.limb":
        return applyLimb(draft, command);
      case "health.hit":
        return applyHit(draft, command, ctx);
    }
  },
  tick: (draft, span) => bleed(draft, span),
  view: { key: "health", project: healthView },
  status: healthStatus,
  events: healthEvents,
});

export * from "./apply";
export * from "./events";
export * from "./schema";
export * from "./status";
export * from "./view";
