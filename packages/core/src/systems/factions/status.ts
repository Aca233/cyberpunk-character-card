import type { StatusContext, SystemStatus } from "../../kernel/system";
import type { factionsView } from "./view";

/** 【当前状态】里势力的几行：成员归属（含靠山与污点）、地盘争夺、内部派系与各势力态度 */

type FactionsView = ReturnType<typeof factionsView>;

const factionsOf = (ctx: StatusContext) => ctx.views.factions as FactionsView;

export const factionsStatus: readonly SystemStatus[] = [
  {
    order: 260,
    lines(ctx) {
      const f = factionsOf(ctx);
      if (f.list.length === 0) return [];
      const lines: string[] = [];
      if (f.membership) {
        const m = f.membership;
        const sponsorPart = m.sponsorName
          ? m.sponsorLost
            ? `，引荐人：${m.sponsorName}（已故）`
            : `，引荐人：${m.sponsorName}`
          : "";
        const strikePart =
          m.strikes.length > 0
            ? `，帮规污点 ${m.strikes.length}/${m.maxStrikes}（${m.strikes.map((s) => `${s.reason}${s.byNpcName ? `/${s.byNpcName}` : ""}`).join("；")}）`
            : "";
        lines.push(
          `势力归属：${m.name}（${m.faction}）· ${m.rank}${sponsorPart}${strikePart}（${m.note}）`,
        );
      }
      const turf = f.list.filter((x) => x.here);
      if (turf.length > 0) {
        lines.push(
          `这里（${f.district}）是${turf.map((x) => `${x.name}（${x.turfNote ?? "整片"}，对你${x.attitudeLabel}）`).join("、")}的地盘`,
        );
      }
      if (f.contested.length > 0) {
        lines.push(
          `火拼争夺中的城区：${f.contested.map((c) => `${c.district}（${c.factionNames.join(" vs ")}：${c.reason}${c.leadNpcName ? `，关键人物 ${c.leadNpcName}` : ""}）`).join("；")}`,
        );
      }
      const wingLines = f.list
        .filter((x) => x.wings.length > 0)
        .map((x) => {
          const ruling = x.rulingWingName
            ? `${x.rulingWingName}${x.rulingVacant ? "·领袖已亡动荡" : "掌权"}`
            : "";
          const side = x.playerWingName ? `，玩家站队${x.playerWingName}` : "";
          const ids = x.wings.map((w) => `${w.id}=${w.name}`).join("/");
          return `${x.name}［${ids}］${ruling}${side}`;
        });
      if (wingLines.length > 0) {
        lines.push(`内部派系：${wingLines.join("；")}`);
      }
      lines.push(
        `势力（faction 写 id）：${f.list.map((x) => `${x.id} ${x.name}${x.attitude === "neutral" ? "" : `【${x.attitudeLabel}${x.reason ? `：${x.reason}` : ""}】`}`).join("、")}；没标的对你中立`,
      );
      return lines;
    },
  },
];
