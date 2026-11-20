import { defineSystem } from "../../kernel/system";
import { applyNote, applyNoteDone } from "./apply";
import { notesRules, notesSection } from "./prompt";
import {
  type NoteCommand,
  NoteCommandSchema,
  type NoteDone,
  NoteDoneSchema,
  type NotesState,
  NotesStateSchema,
} from "./schema";

/** 叙事模型自己的备忘：打算、个人主线、钩子；只进提示词，玩家看不到 */
export const notes = defineSystem<NotesState, NoteCommand | NoteDone>({
  id: "notes",
  state: NotesStateSchema,
  initial: () => ({ notes: [] }),
  commands: {
    note: NoteCommandSchema,
    noteDone: NoteDoneSchema,
  },
  apply(draft, command, ctx) {
    if (command.type === "noteDone") return applyNoteDone(draft, command, ctx.now);
    return applyNote(draft, command, ctx.now);
  },
  rules: [notesRules],
  sections: [
    {
      order: 30,
      title: "备忘",
      stages: ["narrate", "extract"],
      render: ({ world }) => notesSection(NotesStateSchema.parse(world.slices.notes ?? {})),
    },
  ],
});

export * from "./apply";
export * from "./prompt";
export * from "./schema";
