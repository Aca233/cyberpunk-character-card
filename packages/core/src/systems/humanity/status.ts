import type { SystemStatus } from "../../kernel/system";
import type { humanityView } from "./view";
export const humanityStatus: readonly SystemStatus[] = [{ order: 40, lines(ctx) {
  const h = ctx.views.humanity as ReturnType<typeof humanityView>;
  return [`神经状态：${h.stageLabel}${h.suppressed ? "（压制剂正在缓解症状）" : ""}`,
    ...h.symptoms.map((s) => `症状 ${s.id}：${s.description}；诱因：${s.cause}`)];
} }];
