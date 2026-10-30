import type { StatusContext, SystemStatus } from "../../kernel/system";
import { radarLine } from "./radar";
import type { travelView } from "./view";

/** 【当前状态】里出行的几行：名下的车、这一场代码定下的路上偶遇、周边雷达 */

type TravelView = ReturnType<typeof travelView>;

const travelOf = (ctx: StatusContext) => ctx.views.travel as TravelView;

export const travelStatus: readonly SystemStatus[] = [
  {
    order: 250,
    lines(ctx) {
      const t = travelOf(ctx);
      const lines: string[] = [];
      if (t.vehicles.length > 0)
        lines.push(
          `名下的车：${t.vehicles.map((v) => `${v.id}「${v.name}」（${v.classLabel}，速度 ${v.speed} 档，${v.seats} 座，${v.conditionLabel}${v.stolen ? "，偷来的" : ""}）`).join("；")}`,
        );
      if (t.encounter)
        lines.push(
          `路上偶遇（代码定的，这一场要写出来，玩家可以不理）：${t.encounter.label}——${t.encounter.note}`,
        );
      // §十三① 周边雷达：每轮按玩家坐标挑最近的锚点
      const radar = radarLine(t.radar);
      // §七：所在地点坐标本身是估的（恶土、狗镇等），方位只作参考
      if (radar)
        lines.push(
          t.radarRough ? `${radar}（你所在位置的坐标本身是估的，方位和距离只作参考）` : radar,
        );
      return lines;
    },
  },
];
