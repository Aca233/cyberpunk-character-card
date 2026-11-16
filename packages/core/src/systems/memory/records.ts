import type { LogRecord } from "../../kernel/turnlog";
import type { WorldState } from "../../kernel/world";
import { MemoryStateSchema } from "./schema";

/** 仅供提示词与检索；保留存档日志和撤回语义，排除被玩家纠错否定的旧原文。 */
export function memoryRecords(world: WorldState, records: readonly LogRecord[]): LogRecord[] {
  const corrections = MemoryStateSchema.parse(world.slices.memory ?? {}).corrections;
  return records.filter((record) => {
    if (record.kind !== "turn") return true;
    if (record.draft === true || record.unsettled !== undefined) return false;
    const correction = record.scene === undefined ? undefined : corrections[String(record.scene)];
    return correction === undefined || record.seq > correction.through;
  });
}
