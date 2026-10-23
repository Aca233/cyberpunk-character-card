import { z } from "zod";

/** 玩家输入的四种方式：做、说、想，以及不算行动的出戏频道 */
export const InputModeSchema = z.enum(["do", "say", "think", "ooc"]);
export type InputMode = z.infer<typeof InputModeSchema>;

export const TurnInputSchema = z.strictObject({
  mode: InputModeSchema,
  text: z.string().trim().min(1, "行动不能为空").max(2000, "一次最多 2000 字"),
});
export type TurnInput = z.infer<typeof TurnInputSchema>;

/** POST /api/saves/:id/turns 的请求体 */
export const TurnRequestSchema = z.strictObject({
  /** 网页生成的请求 id；同一个 id 重复提交只执行一次 */
  requestId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{8,64}$/, "requestId 只能是 8–64 位字母、数字、- 或 _"),
  /** 提交时网页看到的存档版本；和后端不一致说明别处已经改过，需要先刷新 */
  baseVersion: z.number().int().min(0),
  input: TurnInputSchema,
});
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
  return event.type !== "started" && event.type !== "text";
}
