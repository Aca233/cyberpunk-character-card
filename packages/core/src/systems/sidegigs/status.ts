import type { StatusContext, SystemStatus } from "../../kernel/system";
import type { sidegigsView } from "./apply";

/** 【当前状态】里拳赛和赛车的几行：正在比的那一场、当前地点能比的 */

type SidegigsView = ReturnType<typeof sidegigsView>;

const sidegigsOf = (ctx: StatusContext) => ctx.views.sidegigs as SidegigsView;

export const sidegigsStatus: readonly SystemStatus[] = [
  {
    order: 120,
    lines(ctx) {
      const gigs = sidegigsOf(ctx);
      const lines: string[] = [];
      if (gigs.active)
        lines.push(
          `正在比：${gigs.active.kindLabel}「${gigs.active.name}」，对手${gigs.active.opponent}（${gigs.active.tierLabel}，id ${gigs.active.id}）；按检定结果写 sidegig win 或 lose`,
        );
      const gigsHere = gigs.list.filter((g) => g.here && gigs.active?.id !== g.id);
      if (gigsHere.length > 0)
        lines.push(
          `这里的拳赛和赛车：${gigsHere.map((g) => `${g.id} ${g.kindLabel}「${g.name}」对手${g.opponent}（${g.tierLabel}，押金 ${g.stake}、奖金 ${g.purse}${g.beaten ? "；已经赢过，不再比" : g.rematch ? `；刚输过，${g.rematch} 以后才肯再比` : ""}）：${g.note}`).join("；")}`,
        );
      return lines;
    },
  },
];
