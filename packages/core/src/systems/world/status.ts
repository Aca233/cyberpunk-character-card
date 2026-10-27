import type { StatusContext, SystemStatus } from "../../kernel/system";
import type { worldView } from "./view";

/** 【当前状态】里世界的几行：开头的时间、天气、地点，最后的期限 */

type ClockView = ReturnType<typeof worldView>;

const clockOf = (ctx: StatusContext) => ctx.views.clock as ClockView;

/** 显示名那块投影里地点的中文名；只取这一个字段，不引用 inventory 系统 */
const locationNameOf = (ctx: StatusContext) =>
  (ctx.views.names as { readonly location?: string | null } | undefined)?.location ?? null;

export const worldStatus: readonly SystemStatus[] = [
  {
    order: 20,
    lines(ctx) {
      const v = clockOf(ctx);
      const name = locationNameOf(ctx);
      return [
        `时间：${v.time.text}（${v.time.periodLabel}）`,
        `天气：${v.weather.label}，${v.weather.note}；写进氛围，有时也是掩护或麻烦`,
        `地点：${v.location ?? "尚未确定，由你在开场时安排"}${name && name !== v.location ? `（${name}）` : ""}`,
      ];
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
