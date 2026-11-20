import type { RuleModule } from "../../kernel/system";
import { NOTE_KIND_LABELS, type NotesState } from "./schema";

export const notesRules: RuleModule<NotesState> = {
  id: "notes",
  title: "备忘",
  commands: ["note", "noteDone"],
  when: () => true,
  judge: "",
  narrate: `- 【备忘】是你自己的幕后笔记本，只有你知道：里面记着后续打算、个人主线和埋下还没收的钩子。写正文时顺手照应，前后不矛盾，有合适时机就把伏笔收上；没揭开之前不直白透底。`,
  text: `- 【备忘】记录后续打算（plan）、角色个人主线（arc）和尚未回收的伏笔钩子（hook）。
- 本轮正文出现了新的明确伏笔或后续打算，写一条 note，一句话记清伏笔真相或去向；没有就不写，一轮最多一两条。同一个 id 再写即更新。
- 正文里已经收束、兑现或作废的备忘，写 noteDone。`,
};

/** 给模型看的【备忘】：没了结的；没有就是 undefined */
export function notesSection(state: NotesState): string | undefined {
  const open = state.notes.filter((n) => n.doneAt === null);
  if (open.length === 0) return undefined;
  return open
    .map((n) => `- ［${n.id}，${NOTE_KIND_LABELS[n.kind]}］${n.title}：${n.text}`)
    .join("\n");
}
