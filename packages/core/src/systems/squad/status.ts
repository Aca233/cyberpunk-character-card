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
      function squadTrustNote(affinity: number): string {
        if (affinity >= 40) return "过命交情";
        if (affinity >= 15) return "信得过";
        if (affinity >= -10) return "一般交情";
        if (affinity >= -35) return "心存芥蒂";
        return "随时可能翻脸";
      }

      if (squad.members.length > 0)
        lines.push(
          `小队（${squad.members.length}/${squad.max}；玩家在输入里调度，队员按各自专长与身体状况出手，风险和伤亡也算在队员头上）：${squad.members.map((m) => `${m.name}（${m.npc}，${m.specialty}，${m.terms}，${m.statusLabel}，${squadTrustNote(m.affinity)}；个人麻烦：${m.trouble}）`).join("；")}`,
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
