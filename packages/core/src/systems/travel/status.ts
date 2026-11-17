import type { StatusContext, SystemStatus } from "../../kernel/system";
import type { travelView } from "./view";

/** 【当前状态】里出行的几行：名下的车、这一场代码定下的路上偶遇；附近的地方在世界系统的【地点】里 */

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
          `名下的车：${t.vehicles.map((v) => `${v.id}「${v.name}」（${v.classLabel}，速度 ${v.speed} 档，${v.seats} 座，${v.conditionLabel}${v.stolen ? "，偷来的" : ""}；停在${v.locationName}${v.here ? "，就在身边" : ""}${v.selected ? "，当前选用" : ""}）`).join("；")}`,
        );
      if (t.encounter)
        lines.push(
          // 偶遇是素材，合适才写（用户 2026-11-01 定的「全改」第 3 步）
          `路上偶遇（代码抽的素材，合适就写，玩家可以不理）：${t.encounter.label}——${t.encounter.note}`,
        );
      return lines;
    },
  },
];
