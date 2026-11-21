import type { StatusContext, SystemStatus } from "../../kernel/system";
import type { travelView } from "./view";

/** 【当前状态】里只保留就在身边的车与路上偶遇；远处停放的车辆不每轮刷存在感，需要时由情境节按需带出 */

type TravelView = ReturnType<typeof travelView>;

const travelOf = (ctx: StatusContext) => ctx.views.travel as TravelView;

export const travelStatus: readonly SystemStatus[] = [
  {
    order: 250,
    lines(ctx) {
      const t = travelOf(ctx);
      const lines: string[] = [];
      const nearby = t.vehicles.filter((v) => v.here);
      if (nearby.length > 0) {
        lines.push(
          `身边的车：${nearby
            .map((v) => {
              const flags = [
                v.classLabel,
                v.seats > 0 ? `${v.seats} 座` : null,
                v.condition !== "intact" ? v.conditionLabel : null,
                v.stolen ? "偷来的" : null,
              ].filter((x): x is string => x !== null);
              return `${v.id}「${v.name}」（${flags.join("，")}）`;
            })
            .join("；")}`,
        );
      }
      if (t.encounter) {
        lines.push(
          `路上偶遇（代码抽的素材，合适就写，玩家可以不理）：${t.encounter.label}——${t.encounter.note}`,
        );
      }
      return lines;
    },
  },
];
