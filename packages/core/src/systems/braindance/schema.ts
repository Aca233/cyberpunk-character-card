import { z } from "zod";

const Id = z.string().trim().min(1).max(100);
const Text = z.string().trim().min(1);
const GENERIC_CUES = new Set([
  "是谁",
  "哪里",
  "什么",
  "声音",
  "热源",
  "观察",
  "查看",
  "调查",
  "细节",
  "分析",
  "回放",
  "重播",
]);

/** 先固定作品与可查材料；定稿正文按需保存，不保存答案或线索完成度。 */
export const BdPassageSchema = z.object({
  id: Id,
  label: Text.max(80),
  minutes: z.number().int().min(1).max(1440),
  outline: Text.max(2000),
});
export const BdDetailSchema = z.object({
  id: Id,
  passage: Id,
  cues: z
    .array(
      Text.min(2)
        .max(80)
        .refine(
          (cue) => !GENERIC_CUES.has(cue),
          "查证触发词须指向具体材料，不能仅用声音、哪里或分析等泛词",
        ),
    )
    .min(1)
    .max(12),
  method: z.enum(["observe", "audio", "thermal"]),
  finding: Text.max(3000),
});
export const BdWorkSchema = z
  .object({
    id: Id,
    title: Text.max(80),
    recorder: Text.max(100),
    synopsis: Text.max(1000),
    durationMinutes: z.number().int().min(1).max(1440),
    location: Id.optional(),
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
  z.object({ kind: z.literal("service"), id: Id }),
  z.object({ kind: z.literal("object"), id: Id, device: Id }),
]);
export const BdExperienceSchema = z.object({
  id: Id,
  work: Id,
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
  /** 只保存实际呈现且定稿的作品正文；同行者插话不写入这里。 */
  passages: z.record(z.string(), z.record(z.string(), Text)).default({}),
  active: BdExperienceSchema.nullable().default(null),
  history: z
    .array(
      BdExperienceSchema.extend({ outcome: z.enum(["finished", "exited"]), at: z.number().int() }),
    )
    .default([]),
  discoveries: z
    .array(z.object({ work: Id, detail: Id, finding: Text, at: z.number().int() }))
    .default([]),
  settled: z.array(Id).default([]),
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
      action: z.literal("start"),
      id: Id,
      work: Id,
      source: BdSourceSchema,
      from: Id.optional().describe(
        "从已保存的某次体验位置重新接入；引用 history.id。已结束的收费服务不能复用，需新的实际来源；省略表示从头重看",
      ),
    }),
    z.object({
      ...Event,
      action: z.literal("progress"),
      passage: Id,
      text: Text.optional().describe(
        "初次呈现须写本轮正文中作品片段的定稿原文，不含现场交谈；已有定稿的重播省略 text，直接复用原记录",
      ),
    }),
    z.object({ ...Event, action: z.enum(["finish", "pause", "resume", "exit"]) }),
    z.object({ ...Event, action: z.literal("replay"), passage: Id }),
    z.object({
      ...Event,
      action: z.literal("inspect"),
      detail: Id,
      minutes: z.number().int().min(1).max(240),
    }),
  ])
  .describe(
    "超梦正文体验：先 define 固定新作品；start 引用作品与实际来源（已成交 bd-session 服务或自有载体和设备）；progress 逐个呈现下一片段并保存正文，代码结算该片段分钟；finish 略写正常看完余下时长；pause/resume/exit 暂停、恢复、退出；replay 实际重播已看片段；inspect 仅引用本轮追问已提供的材料细节。收费使用原 trade，以上操作不另扣款，耗时不另发 world.time/phases。查阅旧正文不发操作。",
  );
export type BraindanceCommand = z.infer<typeof BraindanceCommandSchema>;
