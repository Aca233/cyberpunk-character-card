import type { StatusContext, SystemStatus } from "../../kernel/system";
import type { perceivedView } from "./perceived";

/** 【当前状态】里别人眼里的你：NPC 的第一反应照这一行写 */

type PerceivedView = ReturnType<typeof perceivedView>;

const perceivedOf = (ctx: StatusContext) => ctx.views.perceived as PerceivedView;

export const npcStatus: readonly SystemStatus[] = [
  {
    order: 60,
    lines(ctx) {
      return [`别人眼里的你：${perceivedOf(ctx)}`];
    },
  },
];
