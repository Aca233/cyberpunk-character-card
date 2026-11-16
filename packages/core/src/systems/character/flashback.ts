import type { Draft } from "immer";
import type { ApplyOutcome } from "../../kernel/system";
import type {
  CharacterState,
  FlashbackCommand,
} from "./schema";

/** 角色主板上的过往名字 */
export function pastLabels(state: Pick<CharacterState, "traits">): string[] {
  return state.traits.filter((t) => t.slot === "past").map((t) => t.label);
}

/** 开一段闪回：要是角色的过往、没闪回过、眼下不在闪回 */
function startFlashback(draft: Draft<CharacterState>, past: string, now: number): ApplyOutcome {
  if (draft.flashback) return { ok: false, reason: `已经在闪回${draft.flashback.past}` };
  const pasts = pastLabels(draft);
  if (!pasts.includes(past)) {
    return {
      ok: false,
      reason:
        pasts.length === 0
          ? "角色没有过往，不能闪回"
          : `没有这段过往：${past}；角色的过往是 ${pasts.join("、")}`,
    };
  }
  if (!draft.flashbackUsed.includes(past)) draft.flashbackUsed.push(past);
  draft.flashback = { past, startedAt: now, turns: 0 };
  return {
    ok: true,
    notes: [`闪回：${past}（由内容或玩家结束，不推进当前时间、不改变当前财物）`],
  };
}

/** 回到现在；fact 是闪回里确认的事，写进已确定的事实 */
function endFlashback(draft: Draft<CharacterState>, fact: string | undefined): ApplyOutcome {
  const active = draft.flashback;
  if (!active) return { ok: false, reason: "没有在闪回" };
  draft.flashback = null;
  const notes = [`${active.past}的闪回结束，回到现在`];
  if (fact) {
    draft.pastFacts.push({ past: active.past, text: fact });
    notes.push(`${active.past}里确认的事：${fact}`);
  }
  return { ok: true, notes };
}

export function applyFlashback(
  draft: Draft<CharacterState>,
  command: FlashbackCommand,
  now: number,
): ApplyOutcome {
  if (command.action === "end") return endFlashback(draft, command.fact);
  return startFlashback(draft, command.past ?? "", now);
}

/** 交互计数只用于日志，不是玩法配额。 */
export function tickFlashback(draft: Draft<CharacterState>): ApplyOutcome {
  if (draft.flashback) draft.flashback.turns += 1;
  return { ok: true };
}
