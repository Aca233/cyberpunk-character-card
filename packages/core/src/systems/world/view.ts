import type { ViewContext } from "../../kernel/system";
import { formatGameTime, PERIOD_LABELS, periodOf } from "./apply";
import { locationCatalog, WorldClockStateSchema } from "./schema";
import { weatherAt } from "./weather";

/** 玩家看到的时间、天气、地点、场景号和还没处理的期限；projectState 按原位置分开放 */
export function worldView({ world, data }: ViewContext) {
  const clock = WorldClockStateSchema.parse(world.slices.world);
  const period = periodOf(world.time);
  return {
    time: {
      minutes: world.time,
      text: formatGameTime(world.time),
      period,
      periodLabel: PERIOD_LABELS[period],
    },
    /** 天气：按时间、季节和城区算；还没有地点时按市区 */
    weather: weatherAt(
      world.time,
      clock.location === null
        ? null
        : (locationCatalog(data).get(clock.location)?.district ?? null),
    ),
    location: clock.location,
    scene: clock.scene,
    deadlines: clock.deadlines
      .filter((d) => d.handledAt === null)
      .map((d) => ({
        id: d.id,
        label: d.label,
        due: formatGameTime(d.due),
        overdue: d.due <= world.time,
      })),
  };
}
