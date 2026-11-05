import type { ViewContext } from "../../kernel/system";
import {
  formatGameTime,
  isBlackLaceWithdrawal,
  isFatigued,
  PERIOD_LABELS,
  periodOf,
  phaseClockOf,
} from "./apply";
import { locationCatalog, WorldClockStateSchema } from "./schema";
import { weatherAt } from "./weather";

/** 玩家看到的时间、四段相位时钟、疲劳状态、天气、地点、场景号和还没处理的期限 */
export function worldView({ world, data }: ViewContext) {
  const clock = WorldClockStateSchema.parse(world.slices.world);
  const period = periodOf(world.time);
  const phaseClock = phaseClockOf(world.time, clock.sceneStartedAt);
  return {
    time: {
      minutes: world.time,
      text: formatGameTime(world.time),
      period,
      periodLabel: PERIOD_LABELS[period],
      phase: phaseClock.phase,
      phaseLabel: phaseClock.label,
      phasesAwake: clock.phasesAwake ?? 0,
      fatigued: isFatigued(clock),
      blackLaceWithdrawal: isBlackLaceWithdrawal(clock, world.time),
    },
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
