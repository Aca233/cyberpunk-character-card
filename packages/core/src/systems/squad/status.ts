import type { StatusContext, SystemStatus } from "../../kernel/system";
import type { squadView } from "./apply";

/** 【当前状态】里小队的几行：队员、欠薪、等玩家确认的入队请求 */

type SquadView = ReturnType<typeof squadView>;

const squadOf = (ctx: StatusContext) => ctx.views.squad as SquadView;

export const squadStatus: readonly SystemStatus[] = [
  {
    order: 130,
    lines(ctx) {
      const squad = squadOf(ctx);
      const lines: string[] = [];
      if (squad.members.length > 0)
        lines.push(
          `小队（${squad.members.length}/${squad.max}；玩家在输入里调度，队员按专长用自己的属性出手，失败时受伤的是队员）：${squad.members.map((m) => `${m.name}（${m.npc}，${m.specialty}，${m.terms}，${m.statusLabel}，好感 ${m.affinity}；个人麻烦：${m.trouble}）`).join("；")}`,
        );
      for (const m of squad.members)
        if (m.owed > 0)
          lines.push(`欠薪：${m.name}已经 ${m.owed} 周没发薪，${m.leavesAt} 前还不发就会走人`);
      if (squad.offers.length > 0)
        lines.push(
          `等玩家确认的入队请求：${squad.offers.map((o) => `${o.name}（${o.kindLabel}，${o.terms}）`).join("、")}；已经提过了，不要再提，等玩家在小队面板答复`,
        );
      return lines;
    },
  },
];
