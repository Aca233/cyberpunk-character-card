import { z } from "zod";

/** 没了结的备忘最多留这么多条，满了先删最早改过的 */
export const NOTES_OPEN_KEPT = 20;
/** 了结的备忘留这么多条，先删最早了结的；只留着做记录，不进提示词 */
export const NOTES_DONE_KEPT = 20;
export const NOTE_TITLE_CHARS = 24;
export const NOTE_TEXT_CHARS = 160;

const NoteIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, "备忘 id 用小写英文、数字和连字符，例如 debt-maelstrom")
  .max(40);

/** plan 叙事模型的打算，arc 个人主线，hook 挂着的钩子 */
export const NoteKindSchema = z.enum(["plan", "arc", "hook"]);
export type NoteKind = z.infer<typeof NoteKindSchema>;
export const NOTE_KIND_LABELS: Readonly<Record<NoteKind, string>> = {
  plan: "打算",
  arc: "个人主线",
  hook: "钩子",
};

/** 叙事模型自己的备忘；只进提示词，玩家界面、接口和提示条里都没有 */
export const NoteSchema = z.object({
  id: NoteIdSchema,
  kind: NoteKindSchema,
  title: z.string().min(1).max(NOTE_TITLE_CHARS),
  text: z.string().min(1).max(NOTE_TEXT_CHARS),
  at: z.number().int(),
  updatedAt: z.number().int(),
  /** 了结的游戏时间；没了结是 null */
  doneAt: z.number().int().nullable(),
  how: z.string().min(1).max(60).optional(),
});
export type Note = z.infer<typeof NoteSchema>;

export const NotesStateSchema = z.object({
  notes: z.array(NoteSchema).default([]),
});
export type NotesState = z.infer<typeof NotesStateSchema>;

/** 模型使用：记下或更新一条备忘；同一个 id 再写就更新 */
export const NoteCommandSchema = z
  .object({
    type: z.literal("note"),
    id: NoteIdSchema,
    kind: NoteKindSchema.describe("plan 你接下来的打算，arc 角色的个人主线，hook 埋下还没收的钩子"),
    title: z.string().trim().min(1).max(NOTE_TITLE_CHARS),
    text: z
      .string()
      .trim()
      .min(1)
      .max(NOTE_TEXT_CHARS)
      .describe("一句话：打算做什么、伏笔的真相、打算怎么收"),
  })
  .describe(
    "备忘：记下以后要接着写的打算、个人主线和没收的钩子，下一轮起放在【备忘】里；只有你看得到，同一个 id 再写就更新",
  );
export type NoteCommand = z.infer<typeof NoteCommandSchema>;

export const NoteDoneSchema = z
  .object({
    type: z.literal("noteDone"),
    id: NoteIdSchema,
    how: z.string().trim().min(1).max(60),
  })
  .describe("备忘了结：打算做完了、钩子收了、或者不再要了；how 一句话写怎么了结的");
export type NoteDone = z.infer<typeof NoteDoneSchema>;
