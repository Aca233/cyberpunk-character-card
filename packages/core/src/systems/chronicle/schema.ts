import { z } from "zod";

/** 一段履历的标题和正文上限 */
export const CHRONICLE_TITLE_CHARS = 24;
export const CHRONICLE_TEXT_CHARS = 300;
/** 叙事模型写的履历最多留这么多段，满了删最早的 */
export const CHRONICLE_KEPT = 80;
/** 结束故事时玩家写的一句话 */
export const EPITAPH_CHARS = 80;
/** 新角色开局时带进来的传说名册最多几个人 */
export const LEGENDS_SEEDED = 6;
/** 【履历】里给叙事模型看最近几段的标题，免得重复记 */
export const CHRONICLE_RECENT = 3;

/** 叙事模型在一段剧情告一段落时写的总结；玩家在角色卡的履历里看得到 */
export const ChronicleArcSchema = z.object({
  at: z.number().int(),
  title: z.string().min(1).max(CHRONICLE_TITLE_CHARS),
  text: z.string().min(1).max(CHRONICLE_TEXT_CHARS),
});
export type ChronicleArc = z.infer<typeof ChronicleArcSchema>;

/** 角色怎么离开故事：dead 死了，retired 退休，ended 玩家把故事停在这里 */
export const EndingSchema = z.enum(["dead", "retired", "ended"]);
export type Ending = z.infer<typeof EndingSchema>;
export const ENDING_LABELS: Readonly<Record<Ending, string>> = {
  dead: "死在夜之城",
  retired: "退休",
  ended: "故事停在这里",
};

/** 玩家结束故事的两种方式 */
export const StoryEndSchema = z.enum(["retired", "ended"]);
export type StoryEnd = z.infer<typeof StoryEndSchema>;

/** 开局时带进来的一位前人：名字、结局、什么时候、一句话；只给叙事模型看 */
export const LegendNoteSchema = z.object({
  name: z.string().min(1).max(40),
  ending: EndingSchema,
  when: z.string().min(1).max(40),
  line: z.string().min(1).max(200),
});
export type LegendNote = z.infer<typeof LegendNoteSchema>;

export const ChronicleStateSchema = z.object({
  arcs: z.array(ChronicleArcSchema).default([]),
  /** 玩家结束了故事；没结束是 null。死亡看 health，不记在这里 */
  ended: z
    .object({
      how: StoryEndSchema,
      epitaph: z.string().min(1).max(EPITAPH_CHARS).nullable(),
      at: z.number().int(),
    })
    .nullable()
    .default(null),
  /** 开局时的传说名册摘要；之后别的存档进名册也不改，重放结果不变 */
  legends: z.array(LegendNoteSchema).max(LEGENDS_SEEDED).default([]),
});
export type ChronicleState = z.infer<typeof ChronicleStateSchema>;

/** 模型使用：一段剧情告一段落时写进履历 */
export const ChronicleCommandSchema = z
  .object({
    type: z.literal("chronicle"),
    title: z
      .string()
      .trim()
      .min(1)
      .max(CHRONICLE_TITLE_CHARS)
      .describe("这一段的标题，像章节名，例如「漩涡帮的货」"),
    text: z
      .string()
      .trim()
      .min(1)
      .max(CHRONICLE_TEXT_CHARS)
      .describe(
        "两三句话：发生了什么、角色做了什么选择、结果怎样；第三人称，只写正文里已经发生的事",
      ),
  })
  .describe(
    "履历：一段剧情告一段落时（一单委托收尾、一条个人线收住、一段关系有了结果、角色的处境大变）写一段总结记进角色的履历；玩家在角色卡上看得到；不要每轮都写，一轮最多一段",
  );
export type ChronicleCommand = z.infer<typeof ChronicleCommandSchema>;

/** 只能由代码发出：玩家在角色卡上结束故事 */
export const ChronicleEndSchema = z.object({
  type: z.literal("chronicle.end"),
  how: StoryEndSchema,
  epitaph: z.string().trim().min(1).max(EPITAPH_CHARS).nullable(),
});
export type ChronicleEnd = z.infer<typeof ChronicleEndSchema>;

/** 只能由代码发出：开档时把传说名册摘要写进来 */
export const ChronicleSeedSchema = z.object({
  type: z.literal("chronicle.seedLegends"),
  legends: z.array(LegendNoteSchema).max(LEGENDS_SEEDED),
});
export type ChronicleSeed = z.infer<typeof ChronicleSeedSchema>;

export type ChronicleInternal = ChronicleEnd | ChronicleSeed;
