import type { Draft } from "immer";
import type { ApplyOutcome } from "../../kernel/system";
import { type EconomyState, LOOT_EDDIES, type LootCommand, type MoneyCommand } from "./schema";

export function formatEddies(n: number): string {
  return `${n.toLocaleString("en-US")} 欧元`;
}

/** 结算一笔欧元：余额不能为负，同一事件只结算一次 */
export function applyMoney(draft: Draft<EconomyState>, command: MoneyCommand): ApplyOutcome {
  if (command.event !== undefined && draft.settled.includes(command.event)) {
    return { ok: false, reason: `事件 ${command.event} 的欧元已经结算过` };
  }
  if (draft.eddies + command.delta < 0) {
    return {
      ok: false,
      reason: `欧元不够：身上 ${formatEddies(draft.eddies)}，要付 ${formatEddies(-command.delta)}`,
    };
  }
  draft.eddies += command.delta;
  if (command.event !== undefined) draft.settled.push(command.event);
  const sign = command.delta > 0 ? "+" : "−";
  return {
    ok: true,
    notes: [`欧元 ${sign}${Math.abs(command.delta)}（${command.reason}），现有 ${draft.eddies}`],
  };
}

/** 零钱：按掉落表换成欧元；同一批只结算一次 */
export function applyLoot(draft: Draft<EconomyState>, command: LootCommand): ApplyOutcome {
  if (command.event !== undefined && draft.settled.includes(command.event)) {
    return { ok: false, reason: `事件 ${command.event} 的战利品已经结算过` };
  }
  const amount = LOOT_EDDIES[command.tier][command.amount];
  draft.eddies += amount;
  if (command.event !== undefined) draft.settled.push(command.event);
  return { ok: true, notes: [`欧元 +${amount}（${command.reason}），现有 ${draft.eddies}`] };
}
