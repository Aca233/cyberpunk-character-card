import { defineSystem } from "../../kernel/system";
import { applyCombat, countQuick } from "./apply";
import { combatRules } from "./prompt";
import {
  type CombatCommand,
  CombatCommandSchema,
  type CombatState,
  CombatStateSchema,
} from "./schema";

export const combat = defineSystem<CombatState, CombatCommand>({
  id: "combat",
  dependsOn: ["dice", "health", "inventory", "npc"],
  state: CombatStateSchema,
  initial: () => ({ active: null, usedChecks: [], last: null }),
  commands: { combat: CombatCommandSchema },
  apply: (draft, command, ctx) => applyCombat(draft, command, ctx),
  on: { "combat.quick": (draft) => countQuick(draft) },
  rules: [combatRules],
});

export * from "./apply";
export * from "./prompt";
export * from "./schema";
