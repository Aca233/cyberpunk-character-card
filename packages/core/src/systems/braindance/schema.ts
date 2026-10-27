import { z } from "zod";

/**
 * 超梦调查：照原作的超梦体验编辑器，一段录像分视频、音频、红外三个编码层，按时间切成几段；
 * 线索点藏在某一段的某一层里，玩家标出来才看到扫描结果。录像（含哪几条是关键线索、正确结论和真相）
 * 在调查开始时由叙事模型按局面写好，代码校验后冻结，之后谁都不能改。不掷骰：找全关键线索才能下结论，
 * 对错由代码按冻结的答案判断。
 */

export const BD_LAYERS = ["visual", "audio", "thermal"] as const;
export const BdLayerSchema = z.enum(BD_LAYERS);
export type BdLayer = z.infer<typeof BdLayerSchema>;
/** 原作编辑器里的叫法（文本库：视频、音频、红外层） */
export const BD_LAYER_LABELS: Readonly<Record<BdLayer, string>> = {
  visual: "视频",
  audio: "音频",
  thermal: "红外",
};

export const BD_SEGMENTS_MIN = 3;
export const BD_SEGMENTS_MAX = 6;
export const BD_POINTS_MIN = 4;
export const BD_POINTS_MAX = 12;
export const BD_KEYS_MIN = 2;
export const BD_KEYS_MAX = 4;
export const BD_OPTIONS_MIN = 3;
export const BD_OPTIONS_MAX = 4;
/** 每段每层的画面、声音、热成像描写 */
export const BD_LAYER_CHARS = 160;
export const BD_LABEL_CHARS = 24;
export const BD_FACT_NAME_CHARS = 10;
export const BD_FACT_VALUE_CHARS = 40;
export const BD_CONCLUSION_CHARS = 60;
export const BD_TRUTH_CHARS = 200;
/** 留几次查完的调查 */
export const BD_HISTORY_KEPT = 12;
/** 玩家在编辑器里不下结论、直接退出时写的 */
export const BD_ABANDON = "abandon";

const SlugSchema = z.string().regex(/^[a-z0-9-]{1,40}$/, "id 用小写英文、数字和 -，最多 40 位");

export const BdSegmentSchema = z.object({
  /** 录像里的时间点，mm:ss，一段比一段晚 */
  time: z.string().regex(/^\d{2}:\d{2}$/, "time 写 mm:ss"),
  /** 这一段的小标题：玩家看得到 */
  label: z.string().trim().min(1).max(BD_LABEL_CHARS),
  visual: z.string().trim().min(1).max(BD_LAYER_CHARS),
  audio: z.string().trim().min(1).max(BD_LAYER_CHARS),
  thermal: z.string().trim().min(1).max(BD_LAYER_CHARS),
});
export type BdSegment = z.infer<typeof BdSegmentSchema>;

/** 扫描结果的一行：原作的「类型：」「状态：」这种名目加内容 */
export const BdFactSchema = z.object({
  name: z.string().trim().min(1).max(BD_FACT_NAME_CHARS),
  value: z.string().trim().min(1).max(BD_FACT_VALUE_CHARS),
});

export const BdPointSchema = z.object({
  id: SlugSchema,
  /** 在第几段（从 0 数） */
  segment: z
    .number()
    .int()
    .min(0)
    .max(BD_SEGMENTS_MAX - 1),
  layer: BdLayerSchema,
  /** 编辑器里这个点显示的名字（标之前就看得到）：「数据板」「远处的枪声」 */
  label: z.string().trim().min(1).max(BD_LABEL_CHARS),
  /** 标出来以后才给玩家看的扫描结果 */
  scan: z.object({
    facts: z.array(BdFactSchema).min(1).max(3),
    conclusion: z.string().trim().min(1).max(BD_CONCLUSION_CHARS),
  }),
  /** 只给模型和代码：推出结论必须找到的关键线索 */
  key: z.boolean(),
});
export type BdPoint = z.infer<typeof BdPointSchema>;

export const BdOptionSchema = z.object({
  id: SlugSchema.refine((id) => id !== BD_ABANDON, `结论 id 不能叫 ${BD_ABANDON}`),
  /** 结论选项：玩家找全关键线索后看得到；要有看着说得通的错误选项 */
  text: z.string().trim().min(1).max(BD_CONCLUSION_CHARS),
});

export const BdRecordingSchema = z
  .object({
    title: z.string().trim().min(1).max(BD_LABEL_CHARS),
    /** 谁录的：玩家看得到；超梦里感知到的只是录制者感知到的 */
    recorder: z.string().trim().min(1).max(BD_LABEL_CHARS),
    /** 为哪单委托查的；查错了按这单的结局结算 */
    job: z.string().min(1).max(64).optional(),
    segments: z.array(BdSegmentSchema).min(BD_SEGMENTS_MIN).max(BD_SEGMENTS_MAX),
    points: z.array(BdPointSchema).min(BD_POINTS_MIN).max(BD_POINTS_MAX),
    conclusions: z.array(BdOptionSchema).min(BD_OPTIONS_MIN).max(BD_OPTIONS_MAX),
    /** 只给模型和代码：正确结论的 id */
    answer: SlugSchema,
    /** 只给模型：录像背后真正发生了什么 */
    truth: z.string().trim().min(1).max(BD_TRUTH_CHARS),
  })
  .superRefine((r, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: "custom", message });
    for (let i = 1; i < r.segments.length; i += 1) {
      if ((r.segments[i]?.time ?? "") <= (r.segments[i - 1]?.time ?? "")) {
        issue(`segments[${i}] 的 time 要比上一段晚`);
      }
    }
    const ids = new Set<string>();
    for (const p of r.points) {
      if (ids.has(p.id)) issue(`线索点 ${p.id} 重复了`);
      ids.add(p.id);
      if (p.segment >= r.segments.length) {
        issue(`线索点 ${p.id} 在第 ${p.segment} 段，录像只有 ${r.segments.length} 段（从 0 数）`);
      }
    }
    const keys = r.points.filter((p) => p.key).length;
    if (keys < BD_KEYS_MIN || keys > BD_KEYS_MAX) {
      issue(`关键线索要 ${BD_KEYS_MIN}–${BD_KEYS_MAX} 条，现在 ${keys} 条`);
    }
    if (r.points.length - keys < 2) issue("至少要有 2 条不是关键的线索点，别让人一眼看穿");
    const layers = new Set(r.points.filter((p) => p.key).map((p) => p.layer));
    if (layers.size < 2) issue("关键线索至少分在两个编码层里，要玩家切层去找");
    const options = new Set<string>();
    for (const o of r.conclusions) {
      if (options.has(o.id)) issue(`结论 ${o.id} 重复了`);
      options.add(o.id);
    }
    if (!options.has(r.answer)) issue(`answer ${r.answer} 不在 conclusions 里`);
  });
export type BdRecording = z.infer<typeof BdRecordingSchema>;

export const BdInvestigationSchema = z.object({
  /** 开始时冻结的录像 */
  recording: BdRecordingSchema,
  startedAt: z.number().int(),
  /** 标出来的线索点 id，按标的先后 */
  marked: z.array(z.string()).default([]),
});
export type BdInvestigation = z.infer<typeof BdInvestigationSchema>;

/** 查完的一次：correct 为 null 是没下结论就退出了 */
export const BdResultSchema = z.object({
  title: z.string(),
  recorder: z.string(),
  job: z.string().nullable(),
  option: z.string(),
  /** 玩家选的结论原文；放弃时为 null */
  optionText: z.string().nullable(),
  correct: z.boolean().nullable(),
  /** 找到了几条关键线索、一共几条 */
  keysFound: z.number().int().min(0),
  keysTotal: z.number().int().min(0),
  /** 只给模型：真相，查完以后叙事模型可以按局面慢慢透给玩家 */
  truth: z.string(),
  startedAt: z.number().int(),
  at: z.number().int(),
});
export type BdResult = z.infer<typeof BdResultSchema>;

export const BraindanceStateSchema = z.object({
  active: BdInvestigationSchema.nullable().default(null),
  history: z.array(BdResultSchema).default([]),
});
export type BraindanceState = z.infer<typeof BraindanceStateSchema>;

/**
 * 模型使用：
 * {"type": "braindance", "action": "start", "recording": {...}}
 * 玩家拿到一段要查的超梦（委托给的、找超梦编辑借来的、正文里捡到的芯片），坐下来接上时写
 */
export const BraindanceCommandSchema = z
  .object({
    type: z.literal("braindance"),
    action: z.literal("start"),
    recording: BdRecordingSchema,
  })
  .describe(
    "超梦调查：玩家接上一段要查的超梦时写 start，recording 把整段录像一次写好（之后不能改）：title、recorder 录制者、job 为哪单委托查的（可不写）、segments 3–6 段（time mm:ss 递增、label 小标题、visual 视频层、audio 音频层、thermal 红外层各一段描写）、points 4–12 个线索点（id、segment 第几段从 0 数、layer visual/audio/thermal、label 编辑器里的名字、scan 扫描结果：facts 1–3 行 {name, value} 加一句 conclusion、key 是不是关键线索）、关键线索 2–4 条且分在至少两层、conclusions 3–4 个结论 {id, text}（含看着说得通的错误选项）、answer 正确结论的 id、truth 背后真正发生了什么",
  );
export type BraindanceCommand = z.infer<typeof BraindanceCommandSchema>;

/** 只能由代码发出：玩家在编辑器里标出一个线索点 */
export const BdMarkCommandSchema = z.object({
  type: z.literal("braindance.mark"),
  point: SlugSchema,
});
export type BdMarkCommand = z.infer<typeof BdMarkCommandSchema>;

/** 只能由代码发出：玩家下了结论（结论 id），或者不查了（abandon） */
export const BdConcludeCommandSchema = z.object({
  type: z.literal("braindance.conclude"),
  option: SlugSchema,
});
export type BdConcludeCommand = z.infer<typeof BdConcludeCommandSchema>;

export type BraindanceInternal = BdMarkCommand | BdConcludeCommand;
