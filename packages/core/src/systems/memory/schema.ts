import { z } from "zod";

/** 场景摘要最多留这么多条，先删最早的；更早的压进章节摘要（M3 后续） */
export const MEMORY_KEPT = 200;
/** 一条场景摘要最多几个字；规格 100–200 字 */
export const SUMMARY_CHARS = 200;
export const SUMMARY_TITLE_CHARS = 24;
/** 一条摘要最多记几个人、几个关键词 */
export const SUMMARY_PEOPLE = 10;
export const SUMMARY_KEYWORDS = 5;
export const KEYWORD_CHARS = 12;

/** minor 小事，normal 普通，key 关键；检索分数乘它 */
export const ImportanceSchema = z.enum(["minor", "normal", "key"]);
export type Importance = z.infer<typeof ImportanceSchema>;
export const IMPORTANCE_LABELS: Readonly<Record<Importance, string>> = {
  minor: "小事",
  normal: "普通",
  key: "关键",
};

/** 辅助模型写、代码校验过的一条场景摘要 */
export const SceneSummaryFieldsSchema = z.object({
  /** 这是第几个场景（收场前的场次） */
  scene: z.number().int().min(0),
  title: z.string().trim().min(1).max(SUMMARY_TITLE_CHARS),
  text: z.string().trim().min(1).max(SUMMARY_CHARS),
  /** 牵涉到的有卡人物 id */
  people: z.array(z.string().min(1)).max(SUMMARY_PEOPLE),
  /** 地点 id；还没有地点时为 null */
  place: z.string().min(1).nullable(),
  importance: ImportanceSchema,
  keywords: z.array(z.string().trim().min(1).max(KEYWORD_CHARS)).max(SUMMARY_KEYWORDS),
});

export const SceneSummarySchema = SceneSummaryFieldsSchema.extend({
  /** 收场时的游戏时间 */
  at: z.number().int(),
});
export type SceneSummary = z.infer<typeof SceneSummarySchema>;

/** 剧情记忆：现在只有场景摘要；章节摘要和全剧梗概在后续切片 */
export const MemoryStateSchema = z.object({
  scenes: z.array(SceneSummarySchema).default([]),
});
export type MemoryState = z.infer<typeof MemoryStateSchema>;

/** 只能由代码发出：收场后辅助模型写的场景摘要；同一场再写一次整条替换 */
export const MemorySceneCommandSchema = SceneSummaryFieldsSchema.extend({
  type: z.literal("memory.scene"),
});
export type MemorySceneCommand = z.infer<typeof MemorySceneCommandSchema>;

export type MemoryInternal = MemorySceneCommand;
