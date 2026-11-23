import type { StatusContext, SystemStatus } from "../../kernel/system";
import type { travelView } from "./view";

/** 【当前状态】里列出身边与停在别处的名下可用车辆，加上路上偶遇，避免叙事和抽取遗忘车辆位置 */

type TravelView = ReturnType<typeof travelView>;

const travelOf = (ctx: StatusContext) => ctx.views.travel as TravelView;

function formatVehicleFlag(v: TravelView["vehicles"][number]): string {
  const flags = [
    v.classLabel,
    v.seats > 0 ? `${v.seats} 座` : null,
    v.condition !== "intact" ? v.conditionLabel : null,
    v.stolen ? "偷来的" : null,
  ].filter((x): x is string => x !== null);
  return flags.join("，");
}

export const travelStatus: readonly SystemStatus[] = [
  {
    order: 250,
    lines(ctx) {
      const t = travelOf(ctx);
      const lines: string[] = [];
      const nearby = t.vehicles.filter((v) => v.here);
      const elsewhere = t.vehicles.filter((v) => !v.here && v.condition !== "wrecked");
      if (nearby.length > 0) {
        lines.push(
          `身边的车：${nearby
            .map((v) => `${v.id}「${v.name}」（${formatVehicleFlag(v)}）`)
            .join("；")}`,
        );
      }
      if (elsewhere.length > 0) {
        lines.push(
          `名下停在别处的车：${elsewhere
            .map((v) => {
              const flag = formatVehicleFlag(v);
              return `${v.id}「${v.name}」（停在 ${v.locationName}${flag ? `，${flag}` : ""}）`;
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
