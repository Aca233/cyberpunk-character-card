import type { ViewContext } from "../../kernel/system";
import { OPPONENT_TIERS } from "../dice";
import {
  CombatStateSchema,
  FOE_STATE_LABELS,
  INTENTS,
  OVERCLOCK_COST,
  OVERCLOCK_STEP,
  TACTIC_LABELS,
} from "./schema";

/** 玩家可见的战斗：敌人的打算没看穿时盖着；打中你、还没抵的那几下；你用惯的打法 */
export function combatView({ world }: ViewContext) {
  const combat = CombatStateSchema.parse(world.slices.combat);
  const active = combat.active;
  return {
    active: active && {
      round: active.round,
      objective: active.objective,
      defeat: active.defeat,
      foes: active.foes.map((f) => ({
        id: f.id,
        npc: f.npc,
        name: f.name,
        tierLabel: OPPONENT_TIERS[f.tier].label,
        state: f.state,
        stateLabel: FOE_STATE_LABELS[f.state],
        /** 看穿了才有；没看穿是 null */
        intentLabel: f.known && f.intent ? INTENTS[f.intent].label : null,
        fooled: f.fooled,
        bracedLabel: f.braced ? TACTIC_LABELS[f.braced] : null,
      })),
      pending: active.pending.map((p) => ({
        name: p.name,
        label: INTENTS[p.intent].label,
        tier: p.tier,
      })),
      overclocked: active.overclocked,
      overclocks: active.overclocks,
      /** 再超频一次要扣多少人性 */
      overclockCost: OVERCLOCK_COST + OVERCLOCK_STEP * active.overclocks,
      /** 这一轮代码替你出手 */
      takeover: active.takeoverRound === active.round,
    },
    habits: combat.habits,
    last: combat.last,
  };
}
