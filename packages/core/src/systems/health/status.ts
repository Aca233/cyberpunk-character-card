import type { StatusContext, SystemStatus } from "../../kernel/system";
import { MOD_STEP, PENALTY_CAP } from "../dice";
import type { healthView } from "./view";

/** 【当前状态】里生命的几行：开头的生命值，义体之后的断肢 */

type HealthView = ReturnType<typeof healthView>;

const healthOf = (ctx: StatusContext) => ctx.views.health as HealthView;

/** 伤势标签给模型看的写法；没受伤不写 */
const WOUND_TEXT: Readonly<Record<string, string>> = {
  light: "轻伤",
  severe: "重伤",
  zero: "生命归零",
};

export const healthStatus: readonly SystemStatus[] = [
  {
    order: 30,
    lines(ctx) {
      const h = healthOf(ctx);
      return [
        `生命：${h.hp}/${h.max}，${h.conditionLabel}${WOUND_TEXT[h.wound] ? `，${WOUND_TEXT[h.wound]}` : ""}`,
      ];
    },
  },
  {
    order: 200,
    lines(ctx) {
      const h = healthOf(ctx);
      if (h.lostLimbs.length === 0) return [];
      const ids = h.lostLimbs.map((l) => l.id);
      return [
        `断肢：${h.lostLimbs.map((l) => l.label).join("、")}；${ids.some((l) => l.endsWith("arm")) ? "断臂不能用双手武器，" : ""}${ids.some((l) => l.endsWith("leg")) ? "断腿不能追车或步行逃跑，" : ""}相关检定在 penalties 加一项（−${MOD_STEP}，计入 −${PENALTY_CAP} 上限）；找义体医生装手臂或腿部义体就补上了`,
      ];
    },
  },
];
