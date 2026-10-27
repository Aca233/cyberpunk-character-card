import type { StatusContext, SystemStatus } from "../../kernel/system";
import type { traumaView } from "./view";

/** 【当前状态】里创伤小组的一行：会籍和现在叫不叫得来，或者刚过期 */

type TraumaView = ReturnType<typeof traumaView>;

const traumaOf = (ctx: StatusContext) => ctx.views.trauma as TraumaView;

export const traumaStatus: readonly SystemStatus[] = [
  {
    order: 150,
    lines(ctx) {
      const t = traumaOf(ctx);
      if (t.active)
        return [
          `创伤小组：${t.tierLabel}，到 ${t.until}；${t.dispatch.ok ? "现在叫得来（倒下或濒死时写 trauma rescue）" : `现在不会来：${t.dispatch.why}`}`,
        ];
      if (t.lapsed) return [`创伤小组：会籍 ${t.lapsed} 过期了，没续，不会来`];
      return [];
    },
  },
];
