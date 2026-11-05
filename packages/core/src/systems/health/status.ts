import type { StatusContext, SystemStatus } from "../../kernel/system";
import { MOD_STEP, PENALTY_CAP } from "../dice";
import type { healthView } from "./view";

/** 【当前状态】里伤势与身体状况（3.0 废除数字血条剧透，改为四格具象伤势描述） */

type HealthView = ReturnType<typeof healthView>;

const healthOf = (ctx: StatusContext) => ctx.views.health as HealthView;

export const healthStatus: readonly SystemStatus[] = [
  {
    order: 30,
    lines(ctx) {
      const h = healthOf(ctx);
      const painNote =
        h.wounds === 2
          ? h.painSuppressed
            ? "（医疗针临时压制疼痛中）"
            : "（肉体/反应检定 −2，需打医疗针或找医生缝合）"
          : h.wounds === 3
            ? "（全检定 −4）"
            : "";
      return [`身体伤势：${h.woundLabel}，${h.conditionLabel}${painNote}`];
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
