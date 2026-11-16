import type { StatusContext, SystemStatus } from "../../kernel/system";
import type { healthView } from "./view";

/** 【当前状态】里伤势与身体状况（列出具体伤处、诱因、恢复天数与行动牵制，战斗伤口由 combatStatus 输出） */

type HealthView = ReturnType<typeof healthView>;

const healthOf = (ctx: StatusContext) => ctx.views.health as HealthView;

const WOUND_STATUS_NAMES: Readonly<Record<number, string>> = {
  0: "体征平稳",
  1: "表皮擦伤",
  2: "贯通重创",
  3: "机能重残",
  4: "濒死休克",
};

export const healthStatus: readonly SystemStatus[] = [
  {
    order: 30,
    lines(ctx) {
      const h = healthOf(ctx);
      const painNote =
        h.wounds === 2
          ? h.painSuppressed
            ? "（医疗针临时压制疼痛中）"
            : "（剧痛严重拖累发力与反应，需打医疗针或找医生缝合）"
          : h.wounds === 3
            ? "（濒危重伤，任何激烈动作都会加剧伤势、随时失能）"
            : h.wounds === 4
              ? "（濒死失血休克，已失去正常行动能力，急需创伤小组或紧急抢救）"
              : "";
      const out: string[] = [];
      if (h.injuries.length > 0) {
        const items = h.injuries.map((inj) => {
          const where = inj.partLabel ? `${inj.partLabel}` : "躯干";
          const eta = inj.daysLeft > 0 ? `，还要 ${inj.daysLeft} 天` : "，即将长好";
          const care =
            inj.tier === "graze"
              ? "休整可消"
              : h.painSuppressed
                ? "医疗针暂抑痛感，仍需缝合"
                : "未清创缝合";
          return `${where}${inj.tierLabel}（${inj.cause}，${care}${eta}）`;
        });
        out.push(
          `具体伤势：${items.join("；")}${h.condition !== "up" ? `；状态：${h.conditionLabel}` : ""}${painNote}`,
        );
      } else {
        const label = WOUND_STATUS_NAMES[h.wounds] ?? "体征平稳";
        out.push(`身体伤势：${label}，${h.conditionLabel}${painNote}`);
      }
      return out;
    },
  },
  {
    order: 200,
    lines(ctx) {
      const h = healthOf(ctx);
      if (h.lostLimbs.length === 0) return [];
      const ids = h.lostLimbs.map((l) => l.id);
      return [
        `断肢：${h.lostLimbs.map((l) => l.label).join("、")}；${ids.some((l) => l.endsWith("arm")) ? "断臂不能用双手武器、单手抓握与稳定也大幅受限，" : ""}${ids.some((l) => l.endsWith("leg")) ? "断腿不能追车、无法疾跑或步行逃跑，" : ""}身体发力与平衡明显受损；找义体医生装手臂或腿部义体就补上了`,
      ];
    },
  },
];
