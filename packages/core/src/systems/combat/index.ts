import { defineSystem } from "../../kernel/system";
import { applyCombat, countQuick, tickStandoff } from "./apply";
import { combatRules } from "./prompt";
import {
  type CombatCommand,
  CombatCommandSchema,
  type CombatState,
  CombatStateSchema,
  type StandoffTick,
  StandoffTickSchema,
} from "./schema";

export const combat = defineSystem<CombatState, CombatCommand, StandoffTick>({
  id: "combat",
  dependsOn: ["dice", "health", "inventory", "npc"],
  state: CombatStateSchema,
  initial: () => ({ active: null, last: null, standoff: null }),
  commands: { combat: CombatCommandSchema },
  internal: { "combat.standoffTick": StandoffTickSchema },
  apply: (draft, command, ctx) =>
    command.type === "combat.standoffTick" ? tickStandoff(draft) : applyCombat(draft, command, ctx),
  on: {
    "combat.quick": (draft) => countQuick(draft),
    // 对峙不跨场景：换了地点或跳过一段时间就散了
    "scene.end": (draft) => {
      draft.standoff = null;
    },
  },
  rules: [combatRules],
});

export * from "./apply";
export * from "./prompt";
export * from "./schema";
