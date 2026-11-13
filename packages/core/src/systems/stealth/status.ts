import type { StatusContext, SystemStatus } from "../../kernel/system";
import type { stealthView } from "./view";

/** 【当前状态】里潜入警戒的一行：当前场景没有警戒时不写 */

type StealthView = ReturnType<typeof stealthView>;

const stealthOf = (ctx: StatusContext) => ctx.views.stealth as StealthView;

export const stealthStatus: readonly SystemStatus[] = [
  {
    order: 290,
    lines(ctx) {
      const s = stealthOf(ctx);
      if (s.level <= 0) return [];
      return [`潜入警戒：${s.label}${s.lowered ? "，这个场景已经降过一档" : ""}`];
    },
  },
];
