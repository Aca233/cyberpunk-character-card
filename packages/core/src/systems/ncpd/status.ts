import type { StatusContext, SystemStatus } from "../../kernel/system";
import type { ncpdView } from "./view";

/** 【当前状态】里 NCPD 警情的一行：扫描器上挂着的，玩家可以去处理也可以不管 */

type NcpdView = ReturnType<typeof ncpdView>;

const ncpdOf = (ctx: StatusContext) => ctx.views.ncpd as NcpdView;

export const ncpdStatus: readonly SystemStatus[] = [
  {
    order: 160,
    lines(ctx) {
      const alerts = ncpdOf(ctx).alerts;
      if (alerts.length === 0) return [];
      return [
        `NCPD 警情（扫描器上挂着的，玩家可以去处理，也可以不管）：${alerts.map((a) => `${a.id}「${a.label}」在${a.locationName}（${a.district}${a.here ? "，就在这个城区" : ""}，${a.risk >= 3 ? "高危" : a.risk === 2 ? "中危" : "低危"}，赏金 ${a.reward} 欧元，${a.until} 前）：${a.note}`).join("；")}`,
      ];
    },
  },
];
