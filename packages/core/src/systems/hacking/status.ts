import type { StatusContext, SystemStatus } from "../../kernel/system";
import type { hackingView } from "./view";

/** 【当前状态】里骇入的几行：网络接入仓和程序、正在潜网、这里入侵过的网络；没装或损坏时明确标出不可破解 */

type HackingView = ReturnType<typeof hackingView>;
type CyberwareItem = {
  readonly name: string;
  readonly slot: string;
  readonly broken: boolean;
  readonly deckTraits?: readonly string[] | undefined;
};

const hackingOf = (ctx: StatusContext) => ctx.views.hacking as HackingView;

export const hackingStatus: readonly SystemStatus[] = [
  {
    order: 240,
    lines(ctx) {
      const h = hackingOf(ctx);
      if (!h) {
        const chrome = (ctx.views.cyberware as readonly CyberwareItem[] | undefined) ?? [];
        const brokenDeck = chrome.find(
          (c) => c.slot === "os" && c.deckTraits !== undefined && c.broken,
        );
        if (brokenDeck) {
          return [
            `网络接入仓：${brokenDeck.name}已损坏（修好前无法发起任何快速破解、入侵协议、离线破译加密芯片或潜网接入）`,
          ];
        }
        const otherOs = chrome.find((c) => c.slot === "os" && !c.broken);
        return [
          `网络接入仓：未安装${otherOs ? `（当前操作系统为${otherOs.name}）` : ""}；体内缺少发信与破冰硬件，无法发起任何快速破解、无线入侵、门禁/摄像头骇入、离线破译加密芯片或潜网接入（仅有义眼只能光学扫描观察，不能对人或设备上传破解程序）`,
        ];
      }
      const lines: string[] = [];
      const parts = [...h.traitLabels, ...(h.selfIce ? ["配完好自我 ICE"] : [])];
      const suffix = parts.length > 0 ? `（${parts.join("，")}）` : "";
      lines.push(`网络接入仓：${h.deckName}${suffix}`);
      if (h.activeEffects.length > 0) {
        lines.push(
          `当前生效中的快速破解：${h.activeEffects.map((e) => `「${e.label}」→ ${e.target}（${e.effect}）`).join("；")}`,
        );
      }
      if (h.traceAlert) {
        lines.push(
          `网络反追踪警觉：${h.traceAlert.target} 方向检测到反向追踪信号（${h.traceAlert.at}），继续高调攻击可能暴露坐标或招致敌方黑客反制`,
        );
      }
      if (h.dive) {
        const diveNotes =
          h.dive.notes.length > 0 ? `；进展：${h.dive.notes.slice(-3).join("；")}` : "";
        lines.push(
          `潜网中：当前目标接入深入程度 ${h.dive.layer}/${h.dive.layers}（${h.dive.label}），肉身躺在${h.dive.chair}，${h.dive.guard}守着${diveNotes}`,
        );
      }
      if (h.breaches.length > 0)
        lines.push(
          `这里已控制的网络：${h.breaches.map((n) => `${n.name}（${n.at}，拿下${n.gains.join("、")}）`).join("；")}`,
        );
      return lines;
    },
  },
];
