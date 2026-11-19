import type { StatusContext, SystemStatus } from "../../kernel/system";
import type { traumaView } from "./view";

type TraumaView = ReturnType<typeof traumaView>;
const traumaOf = (ctx: StatusContext) => ctx.views.trauma as TraumaView;

export const traumaStatus: readonly SystemStatus[] = [
  {
    order: 150,
    lines(ctx) {
      const t = traumaOf(ctx);
      if (t.active)
        return [
          `创伤小组：${t.tierLabel}，到 ${t.until}；${t.coverage.ok ? "紧急救援保障待命" : `保障受限：${t.coverage.why}`}；${t.rescue.ok ? "当前符合救援条件，实际赶到稳定生命体征后写 trauma rescue" : `当前不能发出 rescue：${t.rescue.why}`}`,
        ];
      if (t.lapsed) return [`创伤小组：会籍 ${t.lapsed} 过期了，没续，不会来`];
      return [];
    },
  },
];
