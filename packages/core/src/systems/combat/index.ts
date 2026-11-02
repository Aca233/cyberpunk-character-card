import { defineSystem } from "../../kernel/system";
import { applyCombat, endRound, overclock, pay } from "./apply";
import { combatRules } from "./prompt";
import {
  type CombatCommand,
  CombatCommandSchema,
  type CombatInternal,
  CombatInternalSchemas,
  type CombatState,
  CombatStateSchema,
} from "./schema";
import { combatStatus } from "./status";
import { combatView } from "./view";

/**
 * 战斗（用户 2026-11-02 定的"战斗推倒重来"）：敌人每轮有盖着的打算，看穿、拦下、骗过它；
 * 没拦下的打中你，你挑拿身体哪块抵；超频拿人性换必中，人性太低时代码替你出手；用惯的打法下一伙人防着
 */
export const combat = defineSystem<CombatState, CombatCommand, CombatInternal>({
  id: "combat",
  dependsOn: ["dice", "health", "inventory", "npc", "humanity"],
  state: CombatStateSchema,
  initial: () => CombatStateSchema.parse({ active: null, last: null }),
  commands: { combat: CombatCommandSchema },
  internal: CombatInternalSchemas,
  apply(draft, command, ctx) {
    switch (command.type) {
      case "combat":
        return applyCombat(draft, command, ctx);
      case "combat.round":
        return endRound(draft, ctx);
      case "combat.pay":
        return pay(draft, command);
      case "combat.overclock":
        return overclock(draft);
    }
  },
  rules: [combatRules],
  view: { key: "combat", project: combatView },
  status: combatStatus,
});

export * from "./apply";
export * from "./prompt";
export * from "./schema";
export * from "./status";
export * from "./view";
