import type { Command } from "../kernel/system";
import type { Closeup, LogRecord } from "../kernel/turnlog";
import type { WorldState } from "../kernel/world";
import {
  locationCatalog,
  WorldClockStateSchema,
  weatherAt,
  withSavedPlaces,
} from "../systems/world";

function clockText(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** 场景标题卡：城区 · 地点 · 时间 · 天气，不调用模型；还没有地点时为 undefined */
export function sceneTitle(
  world: WorldState,
  data: Readonly<Record<string, unknown>>,
): string | undefined {
  const clock = WorldClockStateSchema.parse(world.slices.world);
  if (clock.location === null) return undefined;
  // 存档记下的地点并进地点表：place:、poi:、ft: 的标题卡也显示城区和名字
  const def = locationCatalog(withSavedPlaces(data, world)).get(clock.location);
  const place = def ? `${def.district} · ${def.name}` : clock.location;
  return `${place} · ${clockText(world.time)} · ${weatherAt(world.time, def?.district ?? null).label}`;
}

/** 特写弹窗已退役，保留兼容签名返回 undefined */
export function closeupFor(
  _accepted: readonly Command[],
  _world: WorldState,
  _records: readonly LogRecord[],
  _data: Readonly<Record<string, unknown>>,
): Closeup | undefined {
  return undefined;
}
