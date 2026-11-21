import { z } from "zod";
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

/** POST /api/saves/:id/turns：每次请求提交一条自由行动 */
export const TurnRequestSchema = z.strictObject({
  /** 网页生成的请求 id；同一个 id 重复提交只执行一次 */
  requestId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{8,64}$/, "requestId 只能是 8–64 位字母、数字、- 或 _"),
  /** 提交时网页看到的存档版本；不一致时先刷新 */
  baseVersion: z.number().int().min(0),
  input: TurnInputSchema,
  /** 没带时按常规 */
  offscreen: OffscreenPaceSchema.optional(),
  /** 路上偶遇的频率；没带时按常规 */
  encounters: EncounterPaceSchema.optional(),
});
export type TurnRequest = z.infer<typeof TurnRequestSchema>;

export interface TurnUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens?: number | undefined;
  readonly cacheWriteTokens?: number | undefined;
}

export type TurnStage =
  | "judge"
  | "prepare"
  | "narrate"
  | "extract"
  | "repair"
  | "offscreen"
  | "summary"
  | "commit";

/** 一轮生成过程中推给网页的事件；SSE 的事件名就是 type，事件 id 是它在这一轮里的序号 */
export type TurnEvent =
  | {
      readonly type: "started";
      readonly turnId: string;
      readonly requestId: string;
      readonly baseVersion: number;
    }
  /** 正在执行的后端阶段/模型调用提示，让玩家不必看着空白或停住的正文干等；不是终止事件 */
  | {
      readonly type: "stage";
      readonly stage: TurnStage;
      readonly label: string;
      readonly model?: string;
      readonly detail?: string;
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
  | { readonly type: "thought"; readonly text: string }
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
    event.type !== "stage" &&
    event.type !== "rolled" &&
    event.type !== "boost" &&
    event.type !== "thought" &&
    event.type !== "text"
  );
}
