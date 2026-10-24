import type { Draft } from "immer";
import type { ApplyOutcome } from "../../kernel/system";
import {
  type CharacterState,
  FLASHBACK_TURNS,
  type FlashbackCommand,
  PAST_FACTS_MAX,
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
  if (draft.flashbackUsed.includes(past)) {
    return { ok: false, reason: `${past}已经闪回过，每段过往一生只闪回一次` };
  }
  draft.flashbackUsed.push(past);
  draft.flashback = { past, startedAt: now, turns: 0 };
  return {
    ok: true,
    notes: [`闪回：${past}（最多 ${FLASHBACK_TURNS} 轮，不掷骰、不推进时间、不记账）`],
  };
}

/** 回到现在；fact 是闪回里确认的事，写进已确定的事实 */
function endFlashback(draft: Draft<CharacterState>, fact: string | undefined): ApplyOutcome {
  const active = draft.flashback;
  if (!active) return { ok: false, reason: "没有在闪回" };
  draft.flashback = null;
  const notes = [`${active.past}的闪回结束，回到现在`];
  if (fact) {
    if (draft.pastFacts.length >= PAST_FACTS_MAX) draft.pastFacts.shift();
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

/** 闪回里过了一轮；玩满自动回到现在 */
export function tickFlashback(draft: Draft<CharacterState>): ApplyOutcome {
  const active = draft.flashback;
  if (!active) return { ok: true, notes: [] };
  active.turns += 1;
  if (active.turns >= FLASHBACK_TURNS) {
    draft.flashback = null;
    return { ok: true, notes: [`${active.past}的闪回玩满 ${FLASHBACK_TURNS} 轮，回到现在`] };
  }
  return { ok: true, notes: [`闪回还剩 ${FLASHBACK_TURNS - active.turns} 轮`] };
}
