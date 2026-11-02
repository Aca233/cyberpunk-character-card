import type { StatusContext, SystemStatus } from "../../kernel/system";
import type { combatView } from "./view";

/** 【当前状态】里战斗的几行：每个敌人的情况和打算（看穿没有）、待抵的伤、超频、代码接管 */

type CombatView = ReturnType<typeof combatView>;

const combatOf = (ctx: StatusContext) => ctx.views.combat as CombatView;

export const combatStatus: readonly SystemStatus[] = [
  {
    order: 280,
    lines(ctx) {
      const a = combatOf(ctx).active;
      if (!a) return [];
      const foes = a.foes.map((f) => {
        const bits = [`id ${f.id}`, f.tierLabel, f.stateLabel];
        if (f.intentLabel) bits.push(`这一轮要${f.intentLabel}（玩家已看穿）`);
        else if (f.state === "up" || f.state === "hurt") bits.push("打算还盖着");
        if (f.fooled) bits.push("这一轮落空了");
        if (f.bracedLabel) bits.push(`防着玩家的${f.bracedLabel}`);
        return `${f.name}（${bits.join("，")}）`;
      });
      const lines = [
        `战斗中：第 ${a.round} 轮，目标「${a.objective}」，败局「${a.defeat}」；敌人 ${foes.join("、")}`,
      ];
      if (a.pending.length > 0) {
        lines.push(
          `打中玩家还没抵的：${a.pending.map((p) => `${p.name}${p.label}`).join("、")}；这一轮先让玩家挑拿义体、胳膊腿还是肉身去抵`,
        );
      }
      if (a.overclocked) lines.push("这一轮玩家超频了义体：必中");
      if (a.takeover) {
        lines.push(
          "这一轮代码替玩家出手：玩家的手自己动了，对离得最近的人下死手；正文照这个写，不让玩家选",
        );
      }
      return lines;
    },
  },
];
