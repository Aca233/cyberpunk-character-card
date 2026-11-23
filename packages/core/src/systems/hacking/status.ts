import type { StatusContext, SystemStatus } from "../../kernel/system";
import type { hackingView } from "./view";

/** 【当前状态】里骇入的几行：接入仓硬件、已插装程序芯片、热负荷、破冰立足点、活跃破解、潜网与已控内网 */

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
      const thermalWarn =
        h.thermal.level === "critical"
          ? "【过载临界：再强发必反烧脑神经！】"
          : h.thermal.level === "hot"
            ? "（芯片发烫，硬发高负载/终极程序易烧伤大脑）"
            : "";
      lines.push(`网络接入仓：${h.deckName}${suffix}｜热负荷：${h.thermal.label}${thermalWarn}`);
      const loadedList =
        h.programs.length > 0
          ? h.programs.map((p) => `${p.name}${p.loadLabel ? `[${p.loadLabel}]` : ""}`).join("、")
          : "空槽";
      const spareSuffix =
        h.sparePrograms.length > 0
          ? `；随身芯片盒备用（脱战未潜网可换插）：${h.sparePrograms.map((p) => p.name).join("、")}`
          : "";
      lines.push(
        `接入仓存储插槽（热待命 ${h.programs.length}/${h.slots} 槽）：${loadedList}${spareSuffix}`,
      );
      if (h.breachedTargets.length > 0) {
        lines.push(
          `本场已破开个人黑冰的目标（已建立立足点）：${h.breachedTargets.map((b) => `${b.target}${b.via ? `（经${b.via}）` : ""}`).join("、")}`,
        );
      }
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
