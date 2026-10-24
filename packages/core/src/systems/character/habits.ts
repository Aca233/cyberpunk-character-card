import type { Draft } from "immer";
import type { ApplyOutcome } from "../../kernel/system";
import { type CharacterState, HABITS_MAX, type HabitChange } from "./schema";

/** 叙事模型提议一条习惯：先挂着等玩家确认；已经有的、提过的不再挂 */
export function offerHabit(draft: Draft<CharacterState>, text: string): ApplyOutcome {
  if (draft.habits.includes(text) || draft.habitOffers.includes(text))
    return { ok: true, notes: [] };
  if (draft.habitOffers.length >= HABITS_MAX) draft.habitOffers.shift();
  draft.habitOffers.push(text);
  return { ok: true, notes: [`提议习惯：${text}（等玩家确认）`] };
}

function drop(list: string[], text: string): boolean {
  const i = list.indexOf(text);
  if (i < 0) return false;
  list.splice(i, 1);
  return true;
}

/** 玩家在角色卡上改习惯：add 自己写一条，confirm 认下叙事模型的提议，dismiss 不要这条提议，remove 删掉一条 */
export function changeHabit(draft: Draft<CharacterState>, command: HabitChange): ApplyOutcome {
  const { text } = command;
  switch (command.action) {
    case "add":
    case "confirm": {
      if (command.action === "confirm" && !draft.habitOffers.includes(text)) {
        return { ok: false, reason: "没有这条习惯提议" };
      }
      if (draft.habits.includes(text)) return { ok: false, reason: `已经有这个习惯：${text}` };
      if (draft.habits.length >= HABITS_MAX) {
        return { ok: false, reason: `习惯栏满了（最多 ${HABITS_MAX} 条），先删掉一条` };
      }
      drop(draft.habitOffers, text);
      draft.habits.push(text);
      return { ok: true, notes: [`记下习惯：${text}`] };
    }
    case "dismiss":
      if (!drop(draft.habitOffers, text)) return { ok: false, reason: "没有这条习惯提议" };
      return { ok: true, notes: [`没要这条习惯：${text}`] };
    case "remove":
      if (!drop(draft.habits, text)) return { ok: false, reason: `习惯栏里没有：${text}` };
      return { ok: true, notes: [`删掉习惯：${text}`] };
  }
}
