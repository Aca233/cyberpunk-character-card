import type { ApplyBatchResult, ApplyContext, Command } from "../kernel/system";
import type { WorldState } from "../kernel/world";
import { applyMerchantCommands, type PreparedPurchase } from "./merchant-settlement";

export interface SettlementEvent {
  readonly id: string;
  readonly requires: readonly string[];
  readonly commands: readonly Command[];
  readonly invalid?: string;
}

export interface SettledEvent {
  readonly id: string;
  readonly status: "applied" | "failed" | "blocked";
  readonly reason?: string;
}

/** 因果事件依声明顺序执行一次；只有整个事件提交后才发布状态、说明和购买授权消耗。 */
export function applyEventCommands(
  world: WorldState,
  events: readonly SettlementEvent[],
  ctx: ApplyContext,
  purchases: readonly PreparedPurchase[],
  actionFailure?: string,
): ApplyBatchResult & { readonly events: readonly SettledEvent[] } {
  let current = world;
  let available = purchases.map((_, index) => index) as readonly number[];
  const patches: ApplyBatchResult["patches"][number][] = [];
  const results: ApplyBatchResult["results"][number][] = [];
  const settled: SettledEvent[] = [];
  const prior = new Map<string, SettledEvent>();
  const counts = new Map<string, number>();
  for (const event of events) counts.set(event.id, (counts.get(event.id) ?? 0) + 1);
  for (const event of events) {
    let status: SettledEvent["status"] = "failed";
    let reason = event.invalid;
    if (!reason && (!event.id.trim() || event.id === "$action"))
      reason = "事件 id 为空或使用了保留标识";
    if (!reason && counts.get(event.id) !== 1) reason = "事件 id 重复，无法确认因果依赖";
    if (!reason) {
      for (const dependency of event.requires) {
        if (dependency === "$action") {
          if (actionFailure !== undefined) {
            status = "blocked";
            reason = `玩家行动未成立：${actionFailure}`;
            break;
          }
        } else {
          const previous = prior.get(dependency);
          if (!previous) {
            reason = `依赖 ${dependency} 必须是此前已声明的事件`;
            break;
          }
          if (previous.status !== "applied") {
            status = "blocked";
            reason = `依赖事件 ${dependency} 未生效：${previous.reason ?? previous.status}`;
            break;
          }
        }
      }
    }
    if (reason !== undefined) {
      const rejected = reason;
      results.push(
        ...event.commands.map((command) => ({
          command,
          result: { ok: false as const, reason: rejected },
        })),
      );
    } else {
      const applied = applyMerchantCommands(
        current,
        event.commands,
        { ...ctx, facts: { ...ctx.facts, settlementEventId: event.id } },
        purchases,
        available,
      );
      results.push(...applied.results);
      if (applied.failure !== undefined) reason = applied.failure;
      else {
        current = applied.world;
        patches.push(...applied.patches);
        available = applied.remaining;
        status = "applied";
      }
    }
    const outcome: SettledEvent = {
      id: event.id,
      status,
      ...(reason !== undefined ? { reason } : {}),
    };
    settled.push(outcome);
    prior.set(event.id, outcome);
  }
  return { world: current, patches, results, events: settled };
}
