import type { Draft } from "immer";
import type { ApplyOutcome, Command, SystemContext } from "../../kernel/system";
import { checkFact, isSuccess } from "../dice";
import { FALLOUT_RECENT, type FalloutKind, type FalloutRecord, type FalloutState } from "./schema";

const NOTICED_EVENTS = new Set(["kill", "publicViolence", "theft", "vandalism", "publicHack"]);

function num(v: unknown): number {
  return typeof v === "number" ? v : 0;
}

/**
 * 从这一轮真正生效的指令里认出后果。
 * 花钱只在写检定结果的那一轮算后果，平时买东西、付饭钱不算
 */
export function falloutKinds(commands: readonly Command[], resolving: boolean): FalloutKind[] {
  const kinds = new Set<FalloutKind>();
  for (const c of commands) {
    switch (c.type) {
      case "damage":
        kinds.add("injury");
        break;
      case "money":
        if (resolving && num(c.delta) < 0) kinds.add("money");
        break;
      case "trade":
        if (resolving && c.action !== "sell") kinds.add("money");
        break;
      case "event":
        if (
          NOTICED_EVENTS.has(String(c.kind)) &&
          (num(c.witnesses) > 0 || c.public === true || c.reportedTo !== undefined)
        )
          kinds.add("heat");
        break;
      case "deadline":
        if (c.action === "add") kinds.add("deadline");
        break;
      case "affinity":
        if (num(c.delta) < 0) kinds.add("relationship");
        break;
      case "item":
        if (c.action === "lose") kinds.add("item");
        break;
      case "humanity":
        if (num(c.delta) < 0) kinds.add("humanity");
        break;
      case "combat":
        if (c.action === "start") kinds.add("fight");
        break;
      case "alert":
        if (num(c.delta) > 0) kinds.add("alert");
        break;
      case "jobEnd":
        if (c.outcome === "failed") kinds.add("job");
        break;
    }
  }
  return [...kinds];
}

/** 记下这一轮的后果；检定失败却什么都没发生时，下一轮提醒叙事模型补上 */
export function recordFallout(
  draft: Draft<FalloutState>,
  command: FalloutRecord,
  ctx: SystemContext,
): ApplyOutcome {
  const check = checkFact(ctx.facts);
  const failed = check !== undefined && !isSuccess(check.outcome);
  const kinds = [...new Set(command.kinds)];
  if (kinds.length > 0) draft.owed = null;
  else if (failed && check) draft.owed = { id: check.id, left: 1 };
  else if (draft.owed) {
    if (draft.owed.left <= 0) draft.owed = null;
    else draft.owed.left -= 1;
  }
  // 失败却没落地的检定由 owed 提醒，不进近期列表
  if (kinds.length > 0) {
    draft.recent.push({ at: ctx.now, kinds, failed });
    if (draft.recent.length > FALLOUT_RECENT)
      draft.recent.splice(0, draft.recent.length - FALLOUT_RECENT);
  }
  return { ok: true };
}
