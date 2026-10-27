import type { StatusContext, SystemStatus } from "../../kernel/system";
import type { combatView } from "./view";

/** 【当前状态】里战斗的几行：进行中的交火、濒死、第一段的先机、对峙 */

type CombatView = ReturnType<typeof combatView>;

const combatOf = (ctx: StatusContext) => ctx.views.combat as CombatView;

export const combatStatus: readonly SystemStatus[] = [
  {
    order: 280,
    lines(ctx) {
      const combat = combatOf(ctx);
      const lines: string[] = [];
      if (combat.active) {
        const a = combat.active;
        const enemies = [
          ...a.enemies.map((e) => `${e.group}（${e.tier}，${e.count} 人）`),
          ...a.foes.map(
            (f) =>
              `${f.name}（有卡敌人 ${f.npc}，${f.tier}，${f.stateLabel}${f.state === "down" ? "，等玩家决定杀、放还是抓" : ""}${f.scanned ? "" : "，玩家还没扫描"}）`,
          ),
        ].join("、");
        lines.push(
          `战斗中：第 ${a.moment}/${a.moments} 段，敌人 ${enemies}，${a.objective ? `目标是「${a.objective}」，` : ""}败局是「${a.defeat}」；这一段快捷动作已用 ${a.quick}/${a.quickMax}`,
        );
        if (a.dyingMomentsLeft !== null)
          lines.push(`濒死：还剩 ${a.dyingMomentsLeft} 段内要被救回`);
        if (a.edgeLabel) lines.push(`第一段：${a.edgeLabel}`);
      }
      if (combat.standoff) {
        const s = combat.standoff;
        lines.push(
          s.left > 0
            ? `对峙中：和${s.opponent}，还剩 ${s.left}/${s.rounds} 轮`
            : `对峙到时间了：和${s.opponent}，这一轮对方先动手，发 combat start`,
        );
      }
      return lines;
    },
  },
];
