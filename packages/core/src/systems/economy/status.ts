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
      if (m.chromeCare && (m.chromeCare.overdue || m.chromeCare.dueSoon)) {
        lines.push(
          `义体神经维护：${m.chromeCare.label}${m.chromeCare.overdue ? "已逾期未校准（高压义体易发耳鸣、手抖与排异反应，须回义体医生诊所校准）" : `将在 ${m.chromeCare.daysLeft} 天内到期`}，诊所参考价 ${m.chromeCare.cost.toLocaleString("en-US")} 欧元`,
        );
      }
      return lines;
    },
  },
];
