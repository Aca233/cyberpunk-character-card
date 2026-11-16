import type { StatusContext, SystemStatus } from "../../kernel/system";
import type { ripperdocDebtsView, ripperdocView } from "./ripperdoc";
import type { sandevistanView } from "./sandevistan";
import type { cyberwareView } from "./view";

/** 【当前状态】里义体的几组行：装着的义体、加速义体、当前地点的义体医生、欠医生的钱 */

type CyberwareView = ReturnType<typeof cyberwareView>;
type SandevistanView = ReturnType<typeof sandevistanView>;
type RipperdocView = ReturnType<typeof ripperdocView>;
type RipperdocDebtsView = ReturnType<typeof ripperdocDebtsView>;

export const cyberwareStatus: readonly SystemStatus[] = [
  {
    order: 180,
    lines(ctx: StatusContext) {
      const installed = ctx.views.cyberware as CyberwareView;
      if (installed.length === 0) return [];
      return [
        `义体：${installed.map((c) => `${c.name}（${c.id}，${c.slotLabel}${c.broken ? "，打坏了，修好前用不了" : c.bonusText ? `，${c.bonusText}` : ""}）`).join("、")}`,
      ];
    },
  },
  {
    order: 190,
    lines(ctx: StatusContext) {
      const s = ctx.views.sandevistan as SandevistanView;
      if (!s) return [];
      return [
        `加速义体：${s.name}；玩家主动使用时按真实距离、设备能力和当前损伤判断效果，无固定动作格`,
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
