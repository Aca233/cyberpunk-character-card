import type { StatusContext, SystemStatus } from "../../kernel/system";
import type { hackingView } from "./view";

/** 【当前状态】里骇入的几行：网络接入仓和程序、正在潜网、这里入侵过的网络；没装接入仓不写 */

type HackingView = ReturnType<typeof hackingView>;

const hackingOf = (ctx: StatusContext) => ctx.views.hacking as HackingView;

export const hackingStatus: readonly SystemStatus[] = [
  {
    order: 240,
    lines(ctx) {
      const h = hackingOf(ctx);
      if (!h) return [];
      const lines: string[] = [];
      const parts = [...h.traitLabels, ...(h.selfIce ? ["配完好自我 ICE"] : [])];
      const suffix = parts.length > 0 ? `（${parts.join("，")}）` : "";
      lines.push(`网络接入仓：${h.deckName}${suffix}`);
      if (h.dive)
        lines.push(
          `潜网中：当前目标接入深入程度 ${h.dive.layer}/${h.dive.layers}（${h.dive.label}），肉身躺在${h.dive.chair}，${h.dive.guard}守着`,
        );
      if (h.breaches.length > 0)
        lines.push(
          `这里已控制的网络：${h.breaches.map((n) => `${n.name}（${n.at}，拿下${n.gains.join("、")}）`).join("；")}`,
        );
      return lines;
    },
  },
];
