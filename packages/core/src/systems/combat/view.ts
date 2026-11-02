import type { ViewContext } from "../../kernel/system";
import { OPPONENT_TIERS } from "../dice";
import { itemCatalog } from "../inventory";
import {
  CombatStateSchema,
  FOE_STATE_LABELS,
  INTENTS,
  OVERCLOCK_COST,
  OVERCLOCK_STEP,
  TACTIC_LABELS,
} from "./schema";

/** 玩家可见的战斗：敌人的打算没看穿时盖着；打中你、还没抵的那几下；你用惯的打法 */
export function combatView({ world, data }: ViewContext) {
  const combat = CombatStateSchema.parse(world.slices.combat);
  const active = combat.active;
  const catalog = data.items === undefined ? undefined : itemCatalog(data);
  const named = (ids: readonly string[]) =>
    ids.map((id) => ({ id, name: catalog?.get(id)?.name ?? id }));
  return {
    /** 倒下的人身上还没捡走的（打完以后） */
    loot: (combat.last?.loot ?? [])
      .filter((l) => l.items.length > 0)
      .map((l) => ({ from: l.from, name: l.name, items: named(l.items) })),
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
        /** 倒下了才看得到、捡得到身上的东西 */
        carry: f.state === "down" ? named(f.carry) : [],
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
