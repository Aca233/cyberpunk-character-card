import type { Draft } from "immer";
import type { ApplyOutcome } from "../../kernel/system";
import { CITY_KEPT, type CityEventCommand, type CityState } from "./schema";

/** 按 id 合并：已有的整条替换、保留开始时间；新的不能一上来就是结束了的 */
export function applyCityEvent(
  draft: Draft<CityState>,
  command: CityEventCommand,
  now: number,
): ApplyOutcome {
  const { type: _type, ...event } = command;
  const old = draft.events.find((e) => e.id === event.id);
  if (old) {
    Object.assign(old, event, { updatedAt: now });
    // 整条替换：这次没写城区就去掉旧的
    if (event.district === undefined) delete old.district;
    return { ok: true };
  }
  if (event.status === "over") return { ok: false, reason: `没有 id 为 ${event.id} 的动静` };
  draft.events.push({ ...event, startedAt: now, updatedAt: now });
  while (draft.events.length > CITY_KEPT) {
    const over = draft.events.findIndex((e) => e.status === "over");
    draft.events.splice(Math.max(over, 0), 1);
  }
  return { ok: true };
}
