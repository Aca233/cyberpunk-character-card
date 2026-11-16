import { z } from "zod";
import { MATRIX_MAX } from "../systems/dice/schema";
import { EncounterPaceSchema, TravelRequestSchema } from "../systems/travel/schema";

/** 旧存档里的输入方式：做、说、想、出戏。新输入只有一个文本框，由叙事模型自己判断 */
export const InputModeSchema = z.enum(["do", "say", "think", "ooc"]);
export type InputMode = z.infer<typeof InputModeSchema>;

export const TurnInputSchema = z.strictObject({
  /** 只有旧存档带；新输入不写 */
  mode: InputModeSchema.optional(),
  text: z.string().trim().min(1, "行动不能为空").max(2000, "一次最多 2000 字"),
  /** 这一轮开了斯安威斯坦（选项或判断阶段自动开启）：慢动作里的几个动作 */
  sandevistan: z.boolean().optional(),
  /** 回复第几条消息 */
  replyTo: z.number().int().min(1).optional(),
  /** 玩家已经在提交前确认过这一轮的大额花费 */
  spendOk: z.boolean().optional(),
  /** 路线面板确认的出行：去哪、怎么去；耗时和路费由代码按路线表算 */
  travel: TravelRequestSchema.optional(),
  /**
   * 超梦编辑器里下的结论：写结论选项的 id，或者 abandon（不查了）；
   * 对不对由代码按调查开始前写定的答案判断，叙事模型照结果接着写
   */
  braindance: z
    .string()
    .regex(/^[a-z0-9-]{1,40}$/, "超梦结论写选项 id 或 abandon")
    .optional(),
});
export type TurnInput = z.infer<typeof TurnInputSchema>;

/** 城里的动静（场外推演）多久跑一次：关、慢、常规、快；设置存在浏览器里，每轮随请求带上 */
export const OffscreenPaceSchema = z.enum(["off", "slow", "normal", "fast"]);
export type OffscreenPace = z.infer<typeof OffscreenPaceSchema>;
/** 隔几场推演一次；null 是关掉 */
export const OFFSCREEN_PACE_SCENES: Readonly<Record<OffscreenPace, number | null>> = {
  off: null,
  slow: 5,
  normal: 3,
  fast: 2,
};

/** POST /api/saves/:id/turns 的请求体：一次行动（input），或确认一个待定的检定（confirm），二选一 */
export const TurnRequestSchema = z
  .strictObject({
    /** 网页生成的请求 id；同一个 id 重复提交只执行一次 */
    requestId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{8,64}$/, "requestId 只能是 8–64 位字母、数字、- 或 _"),
    /** 提交时网页看到的存档版本；和后端不一致说明别处已经改过，需要先刷新 */
    baseVersion: z.number().int().min(0),
    input: TurnInputSchema.optional(),
    /** 状态投影 offers.checks 里的检定 id，例如 12 或 12.2 */
    confirm: z
      .string()
      .regex(/^\d+(\.\d+)?$/, "confirm 应为检定 id，例如 12 或 12.2")
      .optional(),
    /** 没带时按常规 */
    offscreen: OffscreenPaceSchema.optional(),
    /** 路上偶遇的频率；没带时按常规 */
    encounters: EncounterPaceSchema.optional(),
    /** 确认检定前玩了入侵协议矩阵小游戏：解开了几段序列；只对智力检定换算成修正 */
    matrix: z.number().int().min(0).max(MATRIX_MAX).optional(),
  })
  .refine(
    (r) => (r.input === undefined) !== (r.confirm === undefined),
    "input 和 confirm 要有且只有一个",
  )
  .refine((r) => r.matrix === undefined || r.confirm !== undefined, "matrix 只能和 confirm 一起带");
export type TurnRequest = z.infer<typeof TurnRequestSchema>;

export interface TurnUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/** 一轮生成过程中推给网页的事件；SSE 的事件名就是 type，事件 id 是它在这一轮里的序号 */
export type TurnEvent =
  | {
      readonly type: "started";
      readonly turnId: string;
      readonly requestId: string;
      readonly baseVersion: number;
    }
  /** 确认检定后先掷骰并写进日志，再请叙事模型写结果；不是终止事件 */
  | {
      readonly type: "rolled";
      readonly checkId: string;
      readonly faces: readonly number[];
      readonly total: number;
      readonly dv: number;
      readonly outcome: "critical" | "success" | "costly" | "failure" | "fumble";
    }
  /** 这一轮激活了斯安威斯坦（前端主动开启或判断阶段识别）：不是终止事件 */
  | { readonly type: "boost"; readonly id: string; readonly name: string }
  | { readonly type: "text"; readonly text: string }
  /** 以下五种是终止事件，每一轮恰好一个 */
  | {
      readonly type: "done";
      readonly seq: number;
      readonly version: number;
      readonly usage?: TurnUsage;
    }
  | { readonly type: "blocked"; readonly reason: string }
  /** 这一轮要一次花掉一大笔钱：先问玩家，什么都没写进存档 */
  | {
      readonly type: "confirmSpend";
      readonly label: string;
      readonly price: number;
      readonly eddies: number;
    }
  | { readonly type: "stopped" }
  | { readonly type: "error"; readonly message: string; readonly retryable: boolean };

export type TerminalTurnEvent = Extract<
  TurnEvent,
  { type: "done" | "blocked" | "confirmSpend" | "stopped" | "error" }
>;

export function isTerminalEvent(event: TurnEvent): event is TerminalTurnEvent {
  return (
    event.type !== "started" &&
    event.type !== "rolled" &&
    event.type !== "boost" &&
    event.type !== "text"
  );
}
