import type { RuleModule } from "../../kernel/system";
import { NOTE_KIND_LABELS, type NotesState } from "./schema";

export const notesRules: RuleModule<NotesState> = {
  id: "notes",
  title: "备忘",
  commands: ["note", "noteDone"],
  when: () => true,
  text: `- 【备忘】是你自己的笔记本，只有你看得到：以后要接着写的打算（plan）、角色的个人主线（arc）、埋下还没收的钩子（hook）。写正文前看一眼，接着它写，前后不矛盾，该收的钩子找机会收。
- 有了新的打算或埋了钩子，写一条 note，一句话写清楚打算怎么走、伏笔的真相是什么；没想好就别记，一轮最多一两条。同一个 id 再写就是更新。
- 打算做完了、钩子收了、不再要了，写 noteDone。`,
};

/** 给模型看的【备忘】：没了结的；没有就是 undefined */
export function notesSection(state: NotesState): string | undefined {
  const open = state.notes.filter((n) => n.doneAt === null);
  if (open.length === 0) return undefined;
  return open
    .map((n) => `- ［${n.id}，${NOTE_KIND_LABELS[n.kind]}］${n.title}：${n.text}`)
    .join("\n");
}
