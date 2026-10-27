import type { ViewContext } from "../../kernel/system";
import { OPPONENT_TIERS } from "../dice";
import { CombatStateSchema, EDGE_LABELS, FOE_STATE_LABELS, MAX_QUICK } from "./schema";

/** 玩家可见的战斗：进行中的交火、对峙和上一场的结果；没扫描过的敌人只给名字和档位 */
export function combatView({ world }: ViewContext) {
  const combat = CombatStateSchema.parse(world.slices.combat);
  const active = combat.active;
  return {
    active: active && {
      /** 第几段，从 1 起 */
      moment: active.current + 1,
      moments: active.moments,
      objective: active.objective ?? null,
      defeat: active.defeat,
      enemies: active.enemies,
      /** 有卡敌人：没扫描过、也还没受伤的，界面不显示情况 */
      foes: (active.foes ?? []).map((f) => ({
        npc: f.npc,
        name: f.name,
        tier: f.tier,
        tierLabel: OPPONENT_TIERS[f.tier].label,
        state: f.state,
        stateLabel: FOE_STATE_LABELS[f.state],
        scanned: f.scanned,
      })),
      /** 这一段用了几个快捷动作，最多 quickMax 个 */
      quick: active.quick ?? 0,
      quickMax: MAX_QUICK,
      /** 濒死时还剩几段结束前要被救回；不在濒死时为 null */
      dyingMomentsLeft: active.dyingUntil === null ? null : active.dyingUntil - active.current + 1,
      /** 第一段谁占先机；过了第一段是 null */
      edge: active.current === 0 ? (active.edge ?? null) : null,
      edgeLabel: active.current === 0 && active.edge ? EDGE_LABELS[active.edge] : null,
    },
    /** 进行中的对峙 */
    standoff: combat.standoff ?? null,
    last: combat.last,
  };
}
