import type { StatusContext, SystemStatus } from "../../kernel/system";
import type { moneyView } from "./view";

/** 【当前状态】里欧元、日常经济体面与重度义体神经维护状态 */

type MoneyView = ReturnType<typeof moneyView>;

const moneyOf = (ctx: StatusContext) => ctx.views.money as MoneyView;

export const economyStatus: readonly SystemStatus[] = [
  {
    order: 50,
    lines(ctx) {
      const m = moneyOf(ctx);
      const assetTail = m.wealth.assets.length > 0 ? `；名下：${m.wealth.assets.join("、")}` : "";
      const lines = [
        `欧元：${m.eddies.toLocaleString("en-US")}（${m.wealth.label}——${m.wealth.summary}${assetTail}）`,
      ];
      if (m.chromeCare) {
        const careStatus = m.chromeCare.overdue
          ? "已逾期未校准（高压义体易发耳鸣、手抖与排异反应，须回义体医生诊所校准）"
          : m.chromeCare.calibrated
            ? `已校准，维护有效期还剩 ${m.chromeCare.daysLeft} 天（本次维护已结算，不得重复收费）`
            : `尚未校准，本期维护将在 ${m.chromeCare.daysLeft} 天内到期`;
        lines.push(
          `义体神经维护：${m.chromeCare.label}，${careStatus}，诊所参考价 ${m.chromeCare.cost.toLocaleString("en-US")} 欧元`,
        );
      }
      return lines;
    },
  },
];
