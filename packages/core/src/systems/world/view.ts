import { districtLawFor, normalizeDistrictId } from "../../district-laws";
import type { ViewContext } from "../../kernel/system";
import {
  formatGameTime,
  isBlackLaceWithdrawal,
  isFatigued,
  PERIOD_LABELS,
  type Period,
  periodOf,
  phaseClockOf,
} from "./apply";
import { locationCatalog, WorldClockStateSchema } from "./schema";
import { weatherAt } from "./weather";

interface SliceEntry {
  readonly id: string;
  readonly district: string;
  readonly period: Period | "any";
  readonly text: string;
}

function ambientSliceFor(
  data: Readonly<Record<string, unknown>>,
  districtId: string | undefined,
  period: Period,
  scene: number,
): string | null {
  if (!districtId || !Array.isArray(data.nightCitySlices)) return null;
  const slices = data.nightCitySlices as readonly SliceEntry[];
  const exact = slices.filter((s) => s.district === districtId && s.period === period);
  const anyPeriod = slices.filter((s) => s.district === districtId && s.period === "any");
  const pool =
    exact.length > 0
      ? exact
      : anyPeriod.length > 0
        ? anyPeriod
        : slices.filter((s) => s.district === districtId);
  if (pool.length === 0) return null;
  return pool[Math.abs(scene) % pool.length]?.text ?? null;
}

/** 玩家看到的时间、四段相位时钟、疲劳状态、天气、地点、城区法制、场景号和还没处理的期限 */
export function worldView({ world, data }: ViewContext) {
  const clock = WorldClockStateSchema.parse(world.slices.world);
  const period = periodOf(world.time);
  const phaseClock = phaseClockOf(world.time, clock.startedAt ?? clock.sceneStartedAt);
  const district =
    clock.location === null ? null : (locationCatalog(data).get(clock.location)?.district ?? null);
  const districtId = normalizeDistrictId(district);
  const districtLaw = districtLawFor(data, district);
  const ambientSlice = ambientSliceFor(data, districtId, period, clock.scene);
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
    weather: weatherAt(world.time, district),
    location: clock.location,
    district,
    districtLaw: districtLaw
      ? {
          id: districtLaw.id,
          name: districtLaw.name,
          securityTier: districtLaw.securityTier,
          forbidsOpenLongArms: districtLaw.forbidsOpenLongArms,
          traumaCoverage: districtLaw.traumaCoverage,
          lawSummary: districtLaw.lawSummary,
        }
      : null,
    ambientSlice,
    scene: clock.scene,
    deadlines: clock.deadlines
      .filter((d) => d.handledAt === null)
      .map((d) => ({
        id: d.id,
        label: d.label,
        due: formatGameTime(d.due),
        dueIn: d.due - world.time,
        overdue: d.due <= world.time,
      })),
  };
}
