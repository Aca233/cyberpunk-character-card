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
      return [`加速义体：${s.name}，斯安威斯坦时刻最多 ${s.slots} 个动作，再开一次人性 −${s.cost}`];
    },
  },
  {
    order: 210,
    lines(ctx: StatusContext) {
      const doc = ctx.views.ripperdoc as RipperdocView;
      if (!doc) return [];
      return [
        `义体医生：${doc.name}在这里（${doc.note}）；玩家可以在界面上直接买、卸义体，代码按货架价结算，你只写场面${doc.blackMarket ? "。这是黑市货，装上的东西可能有故障或追踪器，可以在剧情里兑现" : ""}`,
      ];
    },
  },
  {
    order: 230,
    lines(ctx: StatusContext) {
      const debts = ctx.views.ripperdocDebts as RipperdocDebtsView;
      if (debts.length === 0) return [];
      return [
        `欠义体医生的钱：${debts.map((d) => `${d.docName} ${d.amount} 欧元，${d.due} 前还`).join("、")}；还钱在界面上做，你不写 trade。到期没还，医生会派人来催或上门`,
      ];
    },
  },
];
