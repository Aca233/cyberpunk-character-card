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
/** 当前场的提要和锚点各自限长；锚点以增量保存，不因提要压缩而丢弃。 */
export const SCENE_MEMORY_CHARS = 600;
export const MEMORY_ANCHOR_CHARS = 140;

/** minor 小事，normal 普通，key 关键；检索分数乘它 */
export const ImportanceSchema = z.enum(["minor", "normal", "key"]);
export type Importance = z.infer<typeof ImportanceSchema>;
export const IMPORTANCE_LABELS: Readonly<Record<Importance, string>> = {
  minor: "小事",
  normal: "普通",
  key: "关键",
};

export const MemoryEvidenceSchema = z.object({
  source: z.enum(["input", "narrative"]),
  quote: z.string().trim().min(1).max(240),
});

export const MemoryAnchorFieldsSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9][a-z0-9-]*$/),
  kind: z.enum(["fact", "promise", "plan", "question"]),
  text: z.string().trim().min(1).max(MEMORY_ANCHOR_CHARS),
  people: z.array(z.string().min(1)).max(SUMMARY_PEOPLE),
  keywords: z.array(z.string().trim().min(1).max(KEYWORD_CHARS)).max(SUMMARY_KEYWORDS),
  evidence: MemoryEvidenceSchema,
});
export type MemoryAnchorFields = z.infer<typeof MemoryAnchorFieldsSchema>;

export const MemoryAnchorResolutionSchema = z.object({
  id: z.string().min(1),
  outcome: z.enum(["fulfilled", "cancelled", "answered"]),
  text: z.string().trim().min(1).max(MEMORY_ANCHOR_CHARS),
  evidence: MemoryEvidenceSchema,
});

export const SceneMemoryUpdateSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1)
    .max(SCENE_MEMORY_CHARS)
    .describe(
      `这一场至今的滚动提要，不超过${SCENE_MEMORY_CHARS}字；旧事实保留，计划与承诺仍写为未兑现，不补剧情`,
    ),
  anchors: z
    .array(MemoryAnchorFieldsSchema)
    .describe(
      "本轮新增的重要事实、承诺、计划或待解问题；每条给稳定id和本轮原文证据；已登记的不重写，没有新增写[]",
    ),
  resolve: z
    .array(MemoryAnchorResolutionSchema)
    .describe(
      "本轮确实兑现、取消或回答的旧锚点；引用原id并给本轮证据，计划和威胁不算兑现；没有写[]",
    ),
});
export type SceneMemoryUpdate = z.infer<typeof SceneMemoryUpdateSchema>;

export const MemoryAnchorSchema = MemoryAnchorFieldsSchema.extend({
  scene: z.number().int().min(0),
  place: z.string().nullable(),
  at: z.number().int(),
  resolution: MemoryAnchorResolutionSchema.omit({ id: true })
    .extend({ at: z.number().int() })
    .nullable(),
});
export type MemoryAnchor = z.infer<typeof MemoryAnchorSchema>;

export const ActiveSceneMemorySchema = z.object({
  scene: z.number().int().min(0),
  place: z.string().nullable(),
  text: z.string().trim().min(1).max(SCENE_MEMORY_CHARS),
  at: z.number().int(),
});

/** 抽取中顺带给出的收场摘要；人物和地点还要在结算后验证。 */
export const SceneSummaryProposalSchema = z.object({
  title: z.string().trim().min(1).max(SUMMARY_TITLE_CHARS),
  text: z.string().trim().min(1).max(SUMMARY_CHARS),
  people: z.array(z.string().min(1)).max(SUMMARY_PEOPLE),
  importance: ImportanceSchema,
  keywords: z.array(z.string().trim().min(1).max(KEYWORD_CHARS)).min(2).max(SUMMARY_KEYWORDS),
});

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
  /** 玩家在记忆面板改过 */
  edited: z.boolean().optional(),
});
export type SceneSummary = z.infer<typeof SceneSummarySchema>;

/** 修改记录最多留这么多条，先删最早的 */
export const MEMORY_EDITS_KEPT = 100;

/** 记忆面板的一条修改记录：改了什么、原来是什么、改成什么（删掉为 null） */
export const MemoryEditLogSchema = z.object({
  /** 改的时候的游戏时间 */
  at: z.number().int(),
  /** scene 场景摘要，bond 共同记忆 */
  what: z.enum(["scene", "bond"]),
  /** 给人看的出处，例如「第 3 场」「朱迪」 */
  ref: z.string().min(1).max(40),
  action: z.enum(["edit", "remove"]),
  before: z.string(),
  after: z.string().nullable(),
});
export type MemoryEditLog = z.infer<typeof MemoryEditLogSchema>;

/** 剧情记忆：场景摘要和记忆面板的修改记录；章节摘要和全剧梗概在后续切片 */
export const MemoryStateSchema = z.object({
  scenes: z.array(SceneSummarySchema).default([]),
  edits: z.array(MemoryEditLogSchema).default([]),
  active: ActiveSceneMemorySchema.nullable().default(null),
  /** 收场整理失败时保留完整提要，后续可检索；不是已完成的场景摘要。 */
  pending: z.record(z.string(), ActiveSceneMemorySchema).default({}),
  anchors: z.record(z.string(), MemoryAnchorSchema).default({}),
});
export type MemoryState = z.infer<typeof MemoryStateSchema>;

/** 只能由代码发出：抽取或恢复调用写的场景摘要；同一场再写一次整条替换 */
export const MemorySceneCommandSchema = SceneSummaryFieldsSchema.extend({
  type: z.literal("memory.scene"),
});
export type MemorySceneCommand = z.infer<typeof MemorySceneCommandSchema>;

/** 只能由回合结算发出：保留同一场提要并增量登记锚点，不随省略而删除旧锚点。 */
export const MemoryWorkingCommandSchema = SceneMemoryUpdateSchema.extend({
  type: z.literal("memory.working"),
  scene: z.number().int().min(0),
  place: z.string().nullable(),
});
export type MemoryWorkingCommand = z.infer<typeof MemoryWorkingCommandSchema>;

/** 只能由代码发出：玩家在记忆面板改写或删掉一条场景摘要；before 是玩家看到的正文，对不上就不改 */
export const MemoryEditCommandSchema = z.object({
  type: z.literal("memory.edit"),
  scene: z.number().int().min(0),
  before: z.string().min(1),
  action: z.enum(["edit", "remove"]),
  title: z.string().trim().min(1).max(SUMMARY_TITLE_CHARS).optional(),
  text: z.string().trim().min(1).max(SUMMARY_CHARS).optional(),
  importance: ImportanceSchema.optional(),
});
export type MemoryEditCommand = z.infer<typeof MemoryEditCommandSchema>;

/** 只能由代码发出：记一条修改记录（共同记忆的修改也记在这里） */
export const MemoryLogCommandSchema = MemoryEditLogSchema.omit({ at: true }).extend({
  type: z.literal("memory.log"),
});
export type MemoryLogCommand = z.infer<typeof MemoryLogCommandSchema>;

export type MemoryInternal =
  | MemorySceneCommand
  | MemoryWorkingCommand
  | MemoryEditCommand
  | MemoryLogCommand;
