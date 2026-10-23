import { z } from "zod";
import { GameTimeSchema } from "../world";

export const TRUST_MAX = 100;
/** 和出身、过往无关的中间人从这个信任度起步 */
export const TRUST_START = 10;
/** 接下的委托超过期限没完成扣多少信任 */
export const OVERDUE_TRUST = -3;

export const FixerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  trust: z.number().int().min(0).max(TRUST_MAX),
});
export type Fixer = z.infer<typeof FixerSchema>;

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
  /** 这单带来的街头声望，按半级计 */
  credHalves: z.number().int().min(0),
  /** 中间人信任度的变化；没有中间人时为 null */
  trust: z.object({ from: z.number().int(), to: z.number().int() }).nullable(),
  /** 从接单到结束的人性变化；接单时还没记人性的旧委托为 null */
  humanity: z.number().int().nullable(),
});
export type JobSettlement = z.infer<typeof JobSettlementSchema>;

export const JobSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  /** 派单的中间人 id；熟人求助、过往钩子这类没有中间人 */
  fixer: z.string().min(1).nullable(),
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
  /** 接下后超期扣过信任 */
  overdue: z.boolean(),
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
    fixer: z.string().min(1).optional(),
    client: z.string().min(1),
    location: z.string().min(1).optional(),
    risk: z.number().int().min(1).max(5),
    reward: z.number().int().min(0).max(100_000),
    due: GameTimeSchema.optional(),
    conflict: z.string().min(1),
    twist: z.string().min(1).optional(),
  })
  .describe(
    "挂出委托：fixer 是派单的中间人 id，熟人求助不写；conflict 写谁想要什么、谁会受害；twist 是只有你知道的转折，约三成委托不写；代码按街头声望和信任度检查中间人肯不肯派这个星级",
  );
export type JobOffer = z.infer<typeof JobOfferSchema>;

export const JobAcceptSchema = z
  .object({ type: z.literal("jobAccept"), id: z.string().min(1) })
  .describe("玩家角色在戏里答应接下这单");
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
    /** 实际到手的欧元；不写时干净或带瑕疵完成按说好的报酬，其余为 0 */
    paid: z.number().int().min(0).max(100_000).optional(),
    summary: z.string().min(1),
  })
  .describe(
    "委托结束：clean 干净完成，flawed 带瑕疵完成，abandoned 提前告知放弃，failed 失败，betrayed 背叛雇主；代码按结局给报酬、改中间人信任度；summary 一句话总评",
  );
export type JobEnd = z.infer<typeof JobEndSchema>;

export type JobCommand = JobOffer | JobAccept | JobNote | JobEnd;

/** 只能由代码发出：开档时写入中间人 */
export const SeedFixerSchema = z.object({
  type: z.literal("jobs.seedFixer"),
  id: z.string().min(1),
  name: z.string().min(1),
  trust: z.number().int().min(0).max(TRUST_MAX).default(TRUST_START),
});
export type SeedFixer = z.infer<typeof SeedFixerSchema>;
