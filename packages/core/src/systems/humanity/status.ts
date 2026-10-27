import type { StatusContext, SystemStatus } from "../../kernel/system";
import type { humanityView } from "./view";

/** 【当前状态】里人性的一行 */

type HumanityView = ReturnType<typeof humanityView>;

const humanityOf = (ctx: StatusContext) => ctx.views.humanity as HumanityView;

export const humanityStatus: readonly SystemStatus[] = [
  {
    order: 40,
    lines(ctx) {
      const h = humanityOf(ctx);
      return [`人性：${h.current}/${h.cap}，${h.stageLabel}`];
    },
  },
];
