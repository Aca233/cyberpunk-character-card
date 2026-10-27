import type { StatusContext, SystemStatus } from "../../kernel/system";
import type { factionsView } from "./view";

/** 【当前状态】里势力的几行：当前城区是谁的地盘、各势力对玩家的态度 */

type FactionsView = ReturnType<typeof factionsView>;

const factionsOf = (ctx: StatusContext) => ctx.views.factions as FactionsView;

export const factionsStatus: readonly SystemStatus[] = [
  {
    order: 260,
    lines(ctx) {
      const f = factionsOf(ctx);
      if (f.list.length === 0) return [];
      const lines: string[] = [];
      const turf = f.list.filter((x) => x.here);
      if (turf.length > 0)
        lines.push(
          `这里（${f.district}）是${turf.map((x) => `${x.name}（${x.turfNote ?? "整片"}，对你${x.attitudeLabel}）`).join("、")}的地盘`,
        );
      lines.push(
        `势力（faction 写 id）：${f.list.map((x) => `${x.id} ${x.name}${x.attitude === "neutral" ? "" : `【${x.attitudeLabel}${x.reason ? `：${x.reason}` : ""}】`}`).join("、")}；没标的对你中立`,
      );
      return lines;
    },
  },
];
