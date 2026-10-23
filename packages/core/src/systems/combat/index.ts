import { defineSystem } from "../../kernel/system";
import { applyCombat } from "./apply";
import {
  type CombatCommand,
  CombatCommandSchema,
  type CombatState,
  CombatStateSchema,
} from "./schema";

export const combat = defineSystem<CombatState, CombatCommand>({
  id: "combat",
  dependsOn: ["dice", "health", "inventory"],
  state: CombatStateSchema,
  initial: () => ({ active: null, usedChecks: [], last: null }),
  commands: { combat: CombatCommandSchema },
  apply: (draft, command, ctx) => applyCombat(draft, command, ctx),
});

export * from "./apply";
export * from "./schema";
