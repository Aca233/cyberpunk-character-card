import type { StatusContext, SystemStatus } from "../../kernel/system";
import type { heatView } from "./view";

/** 【当前状态】里警方热度的几行：过往之后的热度星级，NCPD 警情之后的悬赏 */

type HeatView = ReturnType<typeof heatView>;

const heatOf = (ctx: StatusContext) => ctx.views.heat as HeatView;

export const heatStatus: readonly SystemStatus[] = [
  {
    order: 100,
    lines(ctx) {
      const h = heatOf(ctx);
      if (!(h.stars > 0 || h.half)) return [];
      return [
        `警方热度：${h.stars} 星${h.half ? "多" : ""}${h.lastSeen ? `，最后一次被看见是 ${h.lastSeen}` : ""}${h.decayIn !== null ? `，再过 ${Math.ceil(h.decayIn / 60)} 小时不犯事就降一星` : ""}`,
      ];
    },
  },
  {
    order: 170,
    lines(ctx) {
      return heatOf(ctx).bounties.map(
        (b) =>
          `悬赏 ${b.id}：${b.reward} 欧元（${b.since} 起；案由：${b.reasons.join("；")}）${b.hunter ? `，赏金猎人 ${b.hunter} 在追你` : "，还没有赏金猎人：合适的时候让一个登场，先写 npc 建卡，再写 bounty hunter"}；不随时间消失，只能靠剧情了结（bounty resolve）`,
      );
    },
  },
];
