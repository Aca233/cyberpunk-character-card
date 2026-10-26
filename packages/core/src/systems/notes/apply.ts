import type { Draft } from "immer";
import type { ApplyOutcome } from "../../kernel/system";
import {
  NOTES_DONE_KEPT,
  NOTES_OPEN_KEPT,
  type NoteCommand,
  type NoteDone,
  type NotesState,
} from "./schema";

/** 没了结的超出上限时删最早改过的；了结的超出上限时删最早了结的 */
function trim(draft: Draft<NotesState>): void {
  const drop = (pick: (n: NotesState["notes"][number]) => number | null, kept: number) => {
    const list = draft.notes.filter((n) => pick(n) !== null);
    if (list.length <= kept) return;
    const gone = new Set(
      [...list]
        .sort((a, b) => (pick(a) ?? 0) - (pick(b) ?? 0))
        .slice(0, list.length - kept)
        .map((n) => n.id),
    );
    draft.notes = draft.notes.filter((n) => !gone.has(n.id));
  };
  drop((n) => (n.doneAt === null ? n.updatedAt : null), NOTES_OPEN_KEPT);
  drop((n) => n.doneAt, NOTES_DONE_KEPT);
}

/** 叙事模型记下或更新一条备忘；只有模型自己看得到，不出提示条 */
export function applyNote(
  draft: Draft<NotesState>,
  command: NoteCommand,
  now: number,
): ApplyOutcome {
  const old = draft.notes.find((n) => n.id === command.id);
  if (old && old.doneAt !== null) {
    return { ok: false, reason: `备忘 ${command.id} 已经了结了，新的打算换个 id` };
  }
  if (old) {
    if (old.title !== command.title || old.kind !== command.kind || old.text !== command.text) {
      old.title = command.title;
      old.kind = command.kind;
      old.text = command.text;
      old.updatedAt = now;
    }
    return { ok: true };
  }
  draft.notes.push({
    id: command.id,
    kind: command.kind,
    title: command.title,
    text: command.text,
    at: now,
    updatedAt: now,
    doneAt: null,
  });
  trim(draft);
  return { ok: true };
}

export function applyNoteDone(
  draft: Draft<NotesState>,
  command: NoteDone,
  now: number,
): ApplyOutcome {
  const note = draft.notes.find((n) => n.id === command.id);
  if (!note) return { ok: false, reason: `【备忘】里没有 ${command.id}` };
  if (note.doneAt !== null) return { ok: true };
  note.doneAt = now;
  note.how = command.how;
  trim(draft);
  return { ok: true };
}
