import type { StatusContext, SystemStatus } from "../../kernel/system";
import type { moneyView } from "./view";

/** 【当前状态】里欧元的一行 */

type MoneyView = ReturnType<typeof moneyView>;

const moneyOf = (ctx: StatusContext) => ctx.views.money as MoneyView;

export const economyStatus: readonly SystemStatus[] = [
  {
    order: 50,
    lines(ctx) {
      return [`欧元：${moneyOf(ctx).eddies}`];
    },
  },
];
