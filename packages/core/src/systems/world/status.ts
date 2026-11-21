import type { StatusContext, SystemStatus } from "../../kernel/system";
import type { worldView } from "./view";

/** 【当前状态】里世界的几行：开头的时间、天气、地点，最后的期限 */

type ClockView = ReturnType<typeof worldView>;

const clockOf = (ctx: StatusContext) => ctx.views.clock as ClockView;

/** 显示名那块投影里地点的中文名；只取这一个字段，不引用 inventory 系统 */
const locationNameOf = (ctx: StatusContext) =>
  (ctx.views.names as { readonly location?: string | null } | undefined)?.location ?? null;

const TRAUMA_COVERAGE_LABELS = {
  full: "创伤小组全档覆盖",
  platinumOnly: "创伤小组仅白金卡外勤覆盖",
  blocked: "创伤小组空域封锁禁入",
} as const;

export const worldStatus: readonly SystemStatus[] = [
  {
    order: 20,
    lines(ctx) {
      const v = clockOf(ctx);
      const name = locationNameOf(ctx);
      const lines = [
        `时间：${v.time.text}（${v.time.phaseLabel} · ${v.time.periodLabel}）`,
        `天气：${v.weather.label}，${v.weather.note}；写进氛围，有时也是掩护或麻烦`,
        `地点：${v.location ?? "尚未确定，由你在开场时安排"}${name && name !== v.location ? `（${name}）` : ""}`,
      ];
      if (v.districtLaw) {
        const armRule = v.districtLaw.forbidsOpenLongArms
          ? "严禁明带长枪/重武器上街"
          : "街头持械盘查宽松";
        lines.push(
          `本区治安法则（${v.districtLaw.name}）：${armRule}，${TRAUMA_COVERAGE_LABELS[v.districtLaw.traumaCoverage]}。${v.districtLaw.lawSummary}`,
        );
      }
      if (v.ambientSlice) {
        lines.push(`街景呼吸（可选环境背景音，不必强行绑定剧情）：${v.ambientSlice}`);
      }
      if (v.time.fatigued) {
        lines.push("身体疲劳：连续多个时段未睡觉，眼皮发沉、发力与反应明显发滞");
      }
      if (v.time.blackLaceWithdrawal) {
        lines.push("药物戒断：黑蕾丝停药戒断发作，太阳穴抽痛、指尖细颤且情绪焦躁");
      }
      return lines;
    },
  },
  {
    order: 990,
    lines(ctx) {
      return clockOf(ctx).deadlines.map(
        (d) => `期限 ${d.id}：${d.label}，${d.due}${d.overdue ? "（已到期，见【到期事件】）" : ""}`,
      );
    },
  },
];
