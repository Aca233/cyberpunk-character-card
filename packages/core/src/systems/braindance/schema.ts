import { z } from "zod";
import { ContentMediaListSchema } from "../../schemas/content-media";

const Id = z.string().trim().min(1).max(100);
const Text = z.string().trim().min(1);

export const BdTierSchema = z.enum(["commercial", "sensory", "raw", "xbd"]);
export type BdTier = z.infer<typeof BdTierSchema>;
export const BD_TIER_LABELS: Readonly<Record<BdTier, string>> = {
  commercial: "商业娱乐",
  sensory: "感官调谐",
  raw: "调查原片",
  xbd: "地下黑超梦",
};

export const BdModeSchema = z.enum(["immerse", "edit"]);
export type BdMode = z.infer<typeof BdModeSchema>;
export const BD_MODE_LABELS: Readonly<Record<BdMode, string>> = {
  immerse: "沉浸回放",
  edit: "编辑分析",
};

export const BdLayerSchema = z.enum(["visual", "audio", "thermal"]);
export type BdLayer = z.infer<typeof BdLayerSchema>;
export const BD_LAYER_LABELS: Readonly<Record<BdLayer, string>> = {
  visual: "视觉层",
  audio: "音频层",
  thermal: "热成像层",
};

export const BdPassageSchema = z.object({
  id: Id,
  label: Text.max(80),
  minutes: z.number().int().min(1).max(1440),
  outline: Text.max(2000),
  media: ContentMediaListSchema.optional(),
});
export type BdPassage = z.infer<typeof BdPassageSchema>;

export const BdDetailSchema = z.object({
  id: Id,
  passage: Id,
  layer: BdLayerSchema,
  finding: Text.max(3000),
});
export type BdDetail = z.infer<typeof BdDetailSchema>;

export const BdWorkSchema = z
  .object({
    id: Id,
    title: Text.max(80),
    tier: BdTierSchema.default("commercial"),
    recorder: Text.max(100),
    synopsis: Text.max(1000),
    durationMinutes: z.number().int().min(1).max(1440),
    location: Id.optional(),
    /** 地下黑超梦（xbd）的感官过载/精神反噬说明 */
    xbdRisk: Text.max(400).optional(),
    passages: z.array(BdPassageSchema).min(1).max(40),
    details: z.array(BdDetailSchema).max(80).default([]),
  })
  .superRefine((work, ctx) => {
    const ids = new Set(work.passages.map((p) => p.id));
    if (ids.size !== work.passages.length)
      ctx.addIssue({ code: "custom", message: "作品片段 id 不能重复" });
    if (work.passages.reduce((sum, p) => sum + p.minutes, 0) !== work.durationMinutes)
      ctx.addIssue({ code: "custom", message: "片段时长之和必须等于作品时长" });
    if (new Set(work.details.map((d) => d.id)).size !== work.details.length)
      ctx.addIssue({ code: "custom", message: "材料细节 id 不能重复" });
    for (const detail of work.details)
      if (!ids.has(detail.passage))
        ctx.addIssue({ code: "custom", message: `细节 ${detail.id} 引用了不存在的片段` });
  });
export type BdWork = z.infer<typeof BdWorkSchema>;

export const BdWorkListSchema = z.array(BdWorkSchema).superRefine((works, ctx) => {
  if (new Set(works.map((w) => w.id)).size !== works.length)
    ctx.addIssue({ code: "custom", message: "作品 id 不能重复" });
});

export const BdSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("venue"),
    venue: Id.describe("场馆/商家站点 id（如 lizzies-bar、sleeve-corner）"),
    service: Id.optional().describe("可选：本次场馆服务会话 id"),
  }),
  z.object({
    kind: z.literal("carrier"),
    carrier: Id.describe("随身或现场的超梦载体芯片 id"),
    device: Id.describe("随身或现场的播放/编辑头环 id（如 bd-portable-player、bd-editor-wreath）"),
  }),
]);
export type BdSource = z.infer<typeof BdSourceSchema>;

export const BdExperienceSchema = z.object({
  id: Id,
  work: Id,
  mode: BdModeSchema,
  source: BdSourceSchema,
  location: z.string().nullable(),
  startedAt: z.number().int(),
  position: z.number().int().min(0),
  watchedMinutes: z.number().int().min(0),
  elapsed: z.number().int().min(0),
  status: z.enum(["playing", "paused"]),
});
export type BdExperience = z.infer<typeof BdExperienceSchema>;

export const BraindanceStateSchema = z.object({
  works: z.record(z.string(), BdWorkSchema).default({}),
  /** 只保存实际呈现且定稿的作品正文；现场插话不写入这里。 */
  passages: z.record(z.string(), z.record(z.string(), Text)).default({}),
  active: BdExperienceSchema.nullable().default(null),
  history: z
    .array(
      BdExperienceSchema.extend({ outcome: z.enum(["finished", "exited"]), at: z.number().int() }),
    )
    .default([]),
  discoveries: z
    .array(
      z.object({
        work: Id,
        detail: Id,
        layer: BdLayerSchema,
        finding: Text,
        at: z.number().int(),
      }),
    )
    .default([]),
  settled: z.array(z.string().min(1)).default([]),
});
export type BraindanceState = z.infer<typeof BraindanceStateSchema>;

const Event = {
  type: z.literal("braindance"),
  event: Id.describe("本次实际操作的稳定事件 id；重试复用，不与其他操作复用"),
};

export const BraindanceCommandSchema = z
  .discriminatedUnion("action", [
    z.object({ ...Event, action: z.literal("define"), work: BdWorkSchema }),
    z.object({
      ...Event,
      action: z.literal("play"),
      id: Id.describe("本次体验 id；恢复当前暂停的超梦时可复用当前体验 id"),
      work: Id,
      mode: BdModeSchema.default("immerse").describe(
        "immerse 沉浸回放（需播放器或场馆设备）；edit 编辑分析（需专业编辑头环或调谐师工作站）",
      ),
      source: BdSourceSchema,
      from: Id.optional().describe("从已保存的某次体验位置续接（引用 history.id）；省略从头开始"),
    }),
    z.object({
      ...Event,
      action: z.literal("progress"),
      passage: Id,
      text: Text.optional().describe(
        "初次呈现该片段时填写本轮正文中的作品定稿原文；已有定稿的重播省略 text",
      ),
      replay: z
        .boolean()
        .optional()
        .describe("设为 true 表示回放一个已经看过的片段（不推进位置，只结算回放时长）"),
    }),
    z.object({
      ...Event,
      action: z.literal("scan"),
      layer: BdLayerSchema.describe("扫描图层：visual 视觉层 / audio 音频层 / thermal 热成像层"),
      detail: Id.optional().describe(
        "可选：指定本轮定位到的材料细节 id；省略则扫描已看片段上该图层全部未发现细节",
      ),
      minutes: z.number().int().min(1).max(240).default(5),
    }),
    z.object({
      ...Event,
      action: z.literal("record"),
      workId: Id.describe("新录制的 raw 原片作品 id"),
      carrierId: Id.describe("生成到背包里的超梦原片载体物品 id"),
      title: Text.max(80),
      synopsis: Text.max(1000),
      durationMinutes: z.number().int().min(1).max(240).default(5),
      text: Text.max(8000).optional().describe("可选：本段录制现场的客观感官记录原文"),
    }),
    z.object({
      ...Event,
      action: z.literal("stop"),
      outcome: z
        .enum(["paused", "exited", "finished"])
        .describe("paused 暂停交流；exited 中途退出保留进度；finished 略写看完剩余时长并结束"),
    }),
  ])
  .describe(
    "超梦系统：define 固定新作品；play 接入/恢复播放或切换编辑模式；progress 呈现下一片段或重播已看片段；scan 在编辑模式下扫描视觉/音频/热成像三层线索；record 用已安装的超梦录制器（braindance-recorder）现场录制原片并生成芯片载体；stop 暂停/退出/看完。progress/scan/stop(finished) 自动结算时间，不要重复发 world.time。",
  );
export type BraindanceCommand = z.infer<typeof BraindanceCommandSchema>;
