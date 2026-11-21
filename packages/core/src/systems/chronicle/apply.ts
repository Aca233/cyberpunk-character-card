import type { Draft } from "immer";
import type { ApplyOutcome } from "../../kernel/system";
import {
  CHRONICLE_KEPT,
  type ChronicleCommand,
  type ChronicleEnd,
  type ChronicleState,
} from "./schema";

/** 叙事模型写一段履历：同一个标题不重复记，同一分钟只记一段，故事结束后不再记 */
export function applyChronicle(
  draft: Draft<ChronicleState>,
  command: ChronicleCommand,
  now: number,
): ApplyOutcome {
  if (draft.ended) return { ok: false, reason: "这个角色的故事已经结束了" };
  if (draft.arcs.some((a) => a.title === command.title)) {
    return { ok: false, reason: `履历里已经有「${command.title}」这一段了` };
  }
  if (draft.arcs.some((a) => a.at === now)) {
    return { ok: false, reason: "这一轮已经记过一段履历，一轮最多一段" };
  }
  draft.arcs.push({ at: now, title: command.title, text: command.text });
  if (draft.arcs.length > CHRONICLE_KEPT) draft.arcs.splice(0, draft.arcs.length - CHRONICLE_KEPT);
  return { ok: true, notes: [`履历记下「${command.title}」`] };
}

/** 玩家结束故事：之后存档只读 */
export function applyChronicleEnd(
  draft: Draft<ChronicleState>,
  command: ChronicleEnd,
  now: number,
): ApplyOutcome {
  if (draft.ended) return { ok: false, reason: "这个角色的故事已经结束了" };
  draft.ended = { how: command.how, epitaph: command.epitaph, at: now };
  return { ok: true, notes: [command.how === "retired" ? "角色退休了" : "故事停在这里"] };
}
