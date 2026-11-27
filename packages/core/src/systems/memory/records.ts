import type { LogRecord } from "../../kernel/turnlog";
import type { WorldState } from "../../kernel/world";
import { MemoryStateSchema } from "./schema";

const memoryRecordsCache = new WeakMap<WorldState, WeakMap<readonly LogRecord[], LogRecord[]>>();

/** 仅供提示词与检索；保留存档日志和撤回语义，排除被玩家纠错否定的旧原文。同快照引用弱缓存避免重复过滤。 */
export function memoryRecords(world: WorldState, records: readonly LogRecord[]): LogRecord[] {
  const byRecords = memoryRecordsCache.get(world);
  const hit = byRecords?.get(records);
  if (hit !== undefined) return hit;
  const corrections = MemoryStateSchema.parse(world.slices.memory ?? {}).corrections;
  const filtered = records.filter((record) => {
    if (record.kind !== "turn") return true;
    if (record.draft === true || record.unsettled !== undefined) return false;
    const correction = record.scene === undefined ? undefined : corrections[String(record.scene)];
    return correction === undefined || record.seq > correction.through;
  });
  let map = byRecords;
  if (!map) {
    map = new WeakMap();
    memoryRecordsCache.set(world, map);
  }
  map.set(records, filtered);
  return filtered;
}
