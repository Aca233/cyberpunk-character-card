import type { StatusContext, SystemStatus } from "../../kernel/system";
import type { ripperdocDebtsView, ripperdocView } from "./ripperdoc";
import type { sandevistanView } from "./sandevistan";
import { cyberwareLoadProfile } from "./schema";
import type { cyberwareView } from "./view";

/** 【当前状态】里义体的几组行：装着的义体、硬件级别概括、加速义体、当前地点的义体医生、欠医生的钱 */

type CyberwareView = ReturnType<typeof cyberwareView>;
type SandevistanView = ReturnType<typeof sandevistanView>;
type RipperdocView = ReturnType<typeof ripperdocView>;
type RipperdocDebtsView = ReturnType<typeof ripperdocDebtsView>;

function trimAbility(ability: string | null | undefined, maxChars = 88): string {
  const clean = (ability ?? "").trim().replace(/。$/, "");
  if (!clean) return "";
  if (clean.length <= maxChars) return clean;
  const first = clean.split("。")[0]?.trim() ?? "";
  if (first && first.length <= maxChars) return first;
  return `${clean.slice(0, maxChars - 1)}…`;
}

/** 根据已安装且完好的义体数量与稀有度，给出供判断与正文参照的定性战力梯度 */
function chromeTierSummary(installed: CyberwareView): string | null {
  const active = installed.filter((c) => !c.broken);
  if (active.length === 0) return null;
  const highGrade = active.filter(
    (c) => c.iconic || c.rarity === "legendary" || c.rarity === "epic",
  ).length;
  const rarePlus = active.filter(
    (c) => c.iconic || c.rarity === "legendary" || c.rarity === "epic" || c.rarity === "rare",
  ).length;
  const slots = new Set(active.map((c) => c.slot)).size;
  const hasArmor = active.some((c) => c.armor);
  const hasAccel = active.some((c) => c.accelerator);
  const hasArmWeapon = active.some((c) => c.slot === "arms");

  const highlights = [
    hasAccel ? "神经加速" : null,
    hasArmor ? "皮下/骨骼护甲" : null,
    hasArmWeapon ? "手臂内置重武/近战" : null,
  ].filter(Boolean);
  const highlightText = highlights.length > 0 ? `（含${highlights.join("、")}）` : "";

  if (active.length >= 10 || (active.length >= 7 && highGrade >= 3)) {
    return `义体武装度：重度全身军用/顶配改装（完好 ${active.length} 件，覆盖 ${slots} 部位${highGrade > 0 ? `，含 ${highGrade} 件史诗/传说/不朽级` : ""}）${highlightText}。面对普通街头混混、低配帮派杂兵和常规轻武器形成压倒性硬件代差——反应速度、抗击打、力道与输出远超肉体凡胎，小兵正面对抗难以跟上或破防，除非遭遇重火力、精英特勤、高阶黑客、数量围堵或自身明显失误/被偷袭。`;
  }
  if (active.length >= 5 || rarePlus >= 3) {
    return `义体武装度：中高配实战改装（完好 ${active.length} 件，覆盖 ${slots} 部位）${highlightText}。对普通街头混混与无重装杂兵有显著硬件优势，交手时应真实体现反应、防护与义体功能的代差，不按普通凡人拉锯。`;
  }
  if (active.length >= 2) {
    return `义体武装度：基础实战改装（完好 ${active.length} 件）${highlightText}，在对应部位提供明确高于纯肉体的能力。`;
  }
  return null;
}

export const cyberwareStatus: readonly SystemStatus[] = [
  {
    order: 180,
    lines(ctx: StatusContext) {
      const installed = ctx.views.cyberware as CyberwareView;
      if (installed.length === 0) return [];
      const armors = installed.filter((c) => c.armor && !c.broken);
      const lines = [
        `义体（已完好安装即真实生效）：${installed
          .map((c) => {
            const chipTag = c.behaviorChip
              ? `，当前${c.behaviorChip.label}${c.behaviorChip.protocol ? `：${c.behaviorChip.protocol}` : ""}`
              : "";
            const grade = c.iconic ? "不朽" : c.rarityLabel;
            const ability = !c.broken ? trimAbility(c.ability) : "";
            const detail = c.broken
              ? "打坏了，修好前用不了"
              : [ability || c.bonusText].filter(Boolean).join("；");
            return `${c.name}（${c.id}，${[grade, c.slotLabel].filter(Boolean).join("·")}${detail ? `：${detail}` : ""}${chipTag}）`;
          })
          .join("；")}`,
      ];
      const tierLine = chromeTierSummary(installed);
      if (tierLine) lines.push(tierLine);
      const load = cyberwareLoadProfile(
        installed
          .filter((c) => !c.broken)
          .map((c) => ({
            id: c.id,
            name: c.name,
            slot: c.slot,
            humanityCost: c.humanityCost,
            iconic: c.iconic,
            armor: c.armor,
            accelerator: c.accelerator,
            ...(c.deckProfile ? { deckProfile: c.deckProfile } : {}),
            ...(c.deckTraits ? { deckTraits: c.deckTraits } : {}),
            ...(c.exclusiveGroup ? { exclusiveGroup: c.exclusiveGroup } : {}),
          })),
      );
      if (load.tier === "heavy" || load.tier === "extreme" || load.dualCore || load.fullBorg) {
        const pressure =
          load.tier === "extreme"
            ? `负荷指数 ${load.activeLoadScore}（已远超常规肉身神经承载，装新高压件、连开加速、双中枢并发、激战重伤或未用压制剂时极易直接触发排异与赛博精神病症状）`
            : `负荷指数 ${load.activeLoadScore}（持续高压压榨、叠装重器或重大刺激时易起神经排异与感官失真）`;
        lines.push(`义体神经负荷（${load.label}，${pressure}）：${load.summary}`);
      }
      const eyes = installed.filter((c) => c.slot === "eyes" && !c.broken);
      if (eyes.length > 0) {
        const eyeNotes = eyes.map(
          (e) => `${e.name}（${trimAbility(e.ability, 80) || "基础光学扫描"}）`,
        );
        lines.push(
          `义眼光学扫描就绪：${eyeNotes.join("、")}（纯光学扫描观察，不带快速破解能力，快速破解须另装完好网络接入仓；扫描人物可实时看穿义体/防线/伤势并取得先手情报，扫描环境、走廊、门禁与埋伏时按所装义眼型号真实生效，例如穿墙轮廓、微光夜视、识破伪装、标记监控/炮塔/陷阱或弱点落点）`,
        );
      }
      if (armors.length > 0) {
        lines.push(
          `护甲义体生效中：${armors.map((a) => `${a.name}${a.rarityLabel ? `(${a.rarityLabel})` : ""}`).join("、")}（常规街头轻口径流弹、刀砍与钝击难以轻易破防或造成重伤，高口径穿甲/重火力/近距爆头/反器材才构成致命穿透）`,
        );
      }
      return lines;
    },
  },
  {
    order: 190,
    lines(ctx: StatusContext) {
      const s = ctx.views.sandevistan as SandevistanView;
      if (!s) return [];
      return [
        `加速义体：${s.name}；开启后在对手眼里近乎瞬移/定格，普通混混和常规枪手完全来不及举枪或转身，按真实距离与设备能力体现碾压级先手`,
      ];
    },
  },
  {
    order: 210,
    lines(ctx: StatusContext) {
      const doc = ctx.views.ripperdoc as RipperdocView;
      if (!doc) return [];
      return [
        `义体诊所：${doc.name}（doc=${doc.id}，${doc.note}）；按钮与正文共用医生、货架、报价、折抵和债务校验。玩家接受具体服务与旧件处置后才成交；黑市标签本身不等于存在故障或追踪器。`,
      ];
    },
  },
  {
    order: 230,
    lines(ctx: StatusContext) {
      const debts = ctx.views.ripperdocDebts as RipperdocDebtsView;
      if (debts.length === 0) return [];
      return [
        `欠义体医生的钱：${debts.map((d) => `${d.docName} ${d.amount} 欧元，${d.due} 前还`).join("、")}；按钮或正文 cyberware repay 共用还款结算，不另写 trade。催款要符合实际到期和医生知情。`,
      ];
    },
  },
];
