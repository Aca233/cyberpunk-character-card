import { z } from "zod";

/** 旧存档里的输入方式：做、说、想、出戏。新输入只有一个文本框，由叙事模型自己判断 */
export const InputModeSchema = z.enum(["do", "say", "think", "ooc"]);
export type InputMode = z.infer<typeof InputModeSchema>;

export const TurnInputSchema = z.strictObject({
  /** 只有旧存档带；新输入不写 */
  mode: InputModeSchema.optional(),
  text: z.string().trim().min(1, "行动不能为空").max(2000, "一次最多 2000 字"),
  /** 生死瞬间开了斯安威斯坦：这段输入写的是慢动作里的几个动作 */
  sandevistan: z.boolean().optional(),
  /** 回复第几条消息 */
  replyTo: z.number().int().min(1).optional(),
});
export type TurnInput = z.infer<typeof TurnInputSchema>;

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
  })
  .refine(
    (r) => (r.input === undefined) !== (r.confirm === undefined),
    "input 和 confirm 要有且只有一个",
  );
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
      readonly outcome: "critical" | "success" | "failure" | "fumble";
    }
  | { readonly type: "text"; readonly text: string }
  /** 以下四种是终止事件，每一轮恰好一个 */
  | {
      readonly type: "done";
      readonly seq: number;
      readonly version: number;
      readonly usage?: TurnUsage;
    }
  | { readonly type: "blocked"; readonly reason: string }
  | { readonly type: "stopped" }
  | { readonly type: "error"; readonly message: string; readonly retryable: boolean };

export type TerminalTurnEvent = Extract<
  TurnEvent,
  { type: "done" | "blocked" | "stopped" | "error" }
>;

export function isTerminalEvent(event: TurnEvent): event is TerminalTurnEvent {
  return event.type !== "started" && event.type !== "rolled" && event.type !== "text";
}
