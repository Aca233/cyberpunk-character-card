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
      const programs = h.programs.map(
        (p) => `${p.id}「${p.name}」（${p.categoryLabel}，${p.ram} 格：${p.effect}）`,
      );
      lines.push(
        `网络接入仓：${h.deckName}，RAM ${h.ram}/${h.ramMax} 格；已装程序 ${h.programs.length}/${h.slots}：${programs.length > 0 ? programs.join("；") : "一个都没装"}`,
      );
      if (h.dive)
        lines.push(
          `潜网中：第 ${h.dive.layer}/${h.dive.layers} 层（${h.dive.label}），肉身躺在${h.dive.chair}，${h.dive.guard}守着`,
        );
      if (h.breaches.length > 0)
        lines.push(
          `这里入侵过的网络：${h.breaches.map((n) => `${n.name}（${n.at}，拿下${n.gains.join("、")}）`).join("；")}`,
        );
      return lines;
    },
  },
];
