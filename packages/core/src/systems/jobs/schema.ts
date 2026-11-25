import { z } from "zod";
import { GameTimeSchema } from "../world";

export const FixerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});
export type Fixer = z.infer<typeof FixerSchema>;

/** 委托类型：护送、刺杀、绑人或救人、偷东西、破坏、调查、谈判、运货 */
export const JobKindSchema = z.enum([
  "escort",
  "assassinate",
  "abduct",
  "steal",
  "sabotage",
  "investigate",
  "negotiate",
  "deliver",
]);
export type JobKind = z.infer<typeof JobKindSchema>;
export const JOB_KIND_LABELS: Readonly<Record<JobKind, string>> = {
  escort: "护送",
  assassinate: "刺杀",
  abduct: "绑人或救人",
  steal: "偷东西",
  sabotage: "破坏",
  investigate: "调查",
  negotiate: "谈判",
  deliver: "运货",
};

/** 委托类型模板：叙事模型取素材用，不强制套用。数据在 content 包的 jobs.ts */
export const JobTemplateSchema = z.object({
  kind: JobKindSchema,
  /** 常见的分段结构 */
  moments: z.string().min(1),
  /** 潜入放在哪里、怎么用 */
  stealth: z.string().min(1),
  /** 对峙放在哪里 */
  standoff: z.string().min(1),
  /** 典型的败局 */
  defeat: z.string().min(1),
  /** 适合的转折和两难素材 id */
  twists: z.array(z.string().min(1)).default([]),
});
export type JobTemplate = z.infer<typeof JobTemplateSchema>;
export const JobTemplateCatalogSchema = z
  .array(JobTemplateSchema)
  .refine(
    (list) => new Set(list.map((t) => t.kind)).size === list.length,
    "同一类委托只写一个模板",
  );

export const JobOutcomeSchema = z.enum(["clean", "flawed", "abandoned", "failed", "betrayed"]);
export type JobOutcome = z.infer<typeof JobOutcomeSchema>;

export const JobStatusSchema = z.enum([
  "offered",
  "active",
  "expired",
  "clean",
  "flawed",
  "abandoned",
  "failed",
  "betrayed",
]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

/** 结束时记下的结算，给结算卡看；报酬见 paid */
export const JobSettlementSchema = z.object({
  /** 从接单到结束的人性变化；接单时还没记人性的旧委托为 null */
  humanity: z.number().int().nullable(),
});
export type JobSettlement = z.infer<typeof JobSettlementSchema>;

export const JobSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  /** 委托类型；旧存档和没写的是 null */
  kind: JobKindSchema.nullable().default(null),
  /** 派单的中间人 id；熟人求助、过往钩子这类没有中间人 */
  fixer: z.string().min(1).nullable(),
  /**
   * 熟人托事的托事人人物卡 id（用户 2026-10-31 选的「托事影响好感」：答应熟人的事办成加好感，拖着不办或办砸扣好感）；
   * 中间人派的单、旧存档是 null
   */
  asker: z.string().min(1).nullable().default(null),
  /** 真正的雇主 */
  client: z.string().min(1),
  location: z.string().min(1).nullable(),
  /** 风险星级 1–5 */
  risk: z.number().int().min(1).max(5),
  /** 接单时说好的报酬 */
  reward: z.number().int().min(0),
  due: z.number().int().nullable(),
  /** 利益冲突：谁想要什么、谁会因此受害 */
  conflict: z.string().min(1),
  /** 隐藏信息，只有模型知道；约三成委托没有 */
  twist: z.string().min(1).nullable(),
  /** 进展笔记：已经发生了什么、玩家选了哪条路 */
  notes: z.array(z.string().min(1)),
  status: JobStatusSchema,
  offeredAt: z.number().int(),
  acceptedAt: z.number().int().nullable(),
  closedAt: z.number().int().nullable(),
  /** 接下后超期了：只做标记，由叙事模型在正文里回应 */
  overdue: z.boolean(),
  /** 超期这件事叙事模型已经在正文里回应过（写了 jobNote） */
  dueHandled: z.boolean().default(false),
  /** 实际到手的报酬；结束时写 */
  paid: z.number().int().min(0).nullable(),
  summary: z.string().nullable(),
  /** 接单时的人性，结算时算这一单的人性变化 */
  humanityAtAccept: z.number().int().nullable().default(null),
  settlement: JobSettlementSchema.nullable().default(null),
});
export type Job = z.infer<typeof JobSchema>;

export const JobsStateSchema = z.object({
  fixers: z.record(z.string(), FixerSchema),
  /** 按挂出的先后排 */
  jobs: z.array(JobSchema),
});
export type JobsState = z.infer<typeof JobsStateSchema>;

/** 模型使用：挂出一单委托 */
export const JobOfferSchema = z
  .object({
    type: z.literal("jobOffer"),
    id: z.string().min(1),
    title: z.string().min(1),
    kind: JobKindSchema.optional(),
    fixer: z.string().min(1).optional(),
    /** 熟人托事的托事人：只由代码在场外推演里按发消息的人填（用户 2026-10-31 选的「托事影响好感」），模型写的会被覆盖 */
    asker: z.string().min(1).optional(),
    client: z
      .string()
      .min(1)
      .describe("必填：真正的雇主；派单的人不肯说时写「身份不明」或「某某的客户（身份不明）」"),
    location: z
      .string()
      .min(1)
      .optional()
      .describe(
        "办事的地点：尽量写【地点】里已有的 id（例如 kabuki-market、place:3、poi:…），对得上的地图上会标出来；【地点】里没有的地方直接写中文名，不要自己编 place: 编号；说不清在哪就不写",
      ),
    risk: z.number().int().min(1).max(5),
    reward: z.number().int().min(0).max(100_000),
    due: GameTimeSchema.optional(),
    conflict: z.string().min(1),
    twist: z.string().min(1).optional(),
  })
  .describe(
    "挂出委托：只要正文里人物明确提议了一单新活（即便玩家还没答应接），就立刻发这条入账为待接委托；同一中间人可同时挂出多单待接委托，必须使用不同 id，新单绝不覆盖旧单。kind 是委托类型（见【委托类型模板】）；fixer 是派单的中间人的人物卡 id，熟人求助不写；【委托】里没列的中间人也能写，只要他有人物卡（新的中间人同一轮先写 npc 建卡、role 写中间人，再写这条），代码会登记成中间人；conflict 写谁想要什么、谁会受害；twist 是只有你知道的转折，约三成委托不写",
  );
export type JobOffer = z.infer<typeof JobOfferSchema>;

export const JobAcceptSchema = z
  .object({ type: z.literal("jobAccept"), id: z.string().min(1) })
  .describe("玩家角色在正文里答应接下这单");
export type JobAccept = z.infer<typeof JobAcceptSchema>;

export const JobNoteSchema = z
  .object({ type: z.literal("jobNote"), id: z.string().min(1), note: z.string().min(1) })
  .describe("进展笔记：这单有了实质进展、玩家选了某条路、转折被揭开时写一句");
export type JobNote = z.infer<typeof JobNoteSchema>;

export const JobEndSchema = z
  .object({
    type: z.literal("jobEnd"),
    id: z.string().min(1),
    outcome: JobOutcomeSchema,
    /** 实际已经收到的欧元；未到账写 0，不因完成任务自动付款 */
    paid: z.number().int().min(0).max(100_000).default(0),
    summary: z.string().min(1),
  })
  .describe(
    "委托结束：clean 干净完成，flawed 带瑕疵完成，abandoned 提前告知放弃，failed 失败，betrayed 背叛雇主；paid 仅记录实际到账，未收款写 0；不会按结局发声望或好感，关系后果应有实际事实；summary 一句话总评",
  );
export type JobEnd = z.infer<typeof JobEndSchema>;

export type JobCommand = JobOffer | JobAccept | JobNote | JobEnd;

/** 只能由代码发出：开档时写入中间人 */
export const SeedFixerSchema = z.object({
  type: z.literal("jobs.seedFixer"),
  id: z.string().min(1),
  name: z.string().min(1),
});
export type SeedFixer = z.infer<typeof SeedFixerSchema>;
