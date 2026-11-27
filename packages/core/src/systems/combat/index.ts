import { defineSystem } from "../../kernel/system";
import { combatActions } from "./actions";
import { applyCombat, tickCombat } from "./apply";
import { combatRules } from "./prompt";
import {
  type CombatCommand,
  CombatCommandSchema,
  type CombatState,
  CombatStateSchema,
} from "./schema";
import { combatStatus } from "./status";
import { combatView } from "./view";

/**
 * 战斗（用户 2026-11-03 定的"重新构建战斗体系"）：打斗过程全交给叙事，代码只记后果。
 * 每一架留下案底：死者有名有姓、伤口带着来历、流言会走样、录像在别人手里；战利品照旧
 */
export const combat = defineSystem<CombatState, CombatCommand, never>({
  id: "combat",
  dependsOn: ["economy", "factions", "health", "inventory", "npc", "stealth", "world"],
  state: CombatStateSchema,
  initial: () => CombatStateSchema.parse({ active: null, last: null }),
  commands: { combat: CombatCommandSchema },
  internal: {},
  apply: (draft, command, ctx) => applyCombat(draft, command, ctx),
  tick: (draft, span, ctx) => tickCombat(draft, span, ctx),
  rules: [combatRules],
  actions: combatActions,
  view: { key: "combat", project: combatView },
  status: combatStatus,
});

export * from "./actions";
export * from "./apply";
export * from "./names";
export * from "./prompt";
export * from "./schema";
export * from "./status";
export * from "./view";
