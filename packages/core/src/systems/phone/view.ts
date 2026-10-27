import type { ViewContext } from "../../kernel/system";
import { formatGameTime } from "../world";
import { CALL_STATUS_LABELS, PhoneStateSchema } from "./schema";

/** 玩家只看来电身份和接听状态；逐项取值，不把隐藏的通话用意带进投影 */
export function phoneCallsView({ world }: ViewContext) {
  const state = PhoneStateSchema.parse(world.slices.phone ?? {});
  const calls = [...state.calls].reverse().map((call) => ({
    id: call.id,
    from: call.from,
    name: call.name,
    at: formatGameTime(call.at),
    status: call.status,
    statusLabel: CALL_STATUS_LABELS[call.status],
    endedAt: call.endedAt === null ? null : formatGameTime(call.endedAt),
  }));
  return {
    incoming: calls.find((call) => call.status === "ringing") ?? null,
    history: calls.filter((call) => call.status !== "ringing"),
  };
}
