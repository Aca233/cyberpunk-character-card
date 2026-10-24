import { defineSystem } from "../../kernel/system";
import { maxHp } from "../dice";
import { applyDamage, applyHeal, applyLimb, bleed, die, revive, setMax } from "./apply";
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

export const health = defineSystem<HealthState, DamageCommand | HealCommand, HealthInternal>({
  id: "health",
  dependsOn: ["dice", "inventory"],
  state: HealthStateSchema,
  initial: () => {
    const max = maxHp(3, 1);
    return {
      hp: max,
      max,
      condition: "up",
      severeSince: null,
      bleeds: 0,
      damagedBy: null,
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
    }
  },
  tick: (draft, span) => bleed(draft, span),
});

export * from "./apply";
export * from "./schema";
