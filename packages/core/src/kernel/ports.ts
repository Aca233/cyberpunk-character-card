import type { Snapshot } from "./world";

/** 骰子来源；后端用加密随机数实现，测试和测评可以固定结果 */
export interface Rng {
  /** 返回 1 到 sides 之间的整数 */
  roll(sides: number): number;
}

export interface Clock {
  now(): Date;
}

/** 存档读写；后端用 data/ 目录实现 */
export interface Storage {
  readLog(saveId: string): Promise<string>;
  appendLog(saveId: string, line: string): Promise<void>;
  readSnapshots(saveId: string): Promise<readonly Snapshot[]>;
  writeSnapshot(saveId: string, snapshot: Snapshot): Promise<void>;
}

/** core 不依赖 DOM 和 Node，这里只描述用到的部分，标准的 AbortSignal 可以直接传入 */
export interface AbortSignalLike {
  readonly aborted: boolean;
  addEventListener(type: "abort", listener: () => void): void;
}

export interface LlmMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface LlmRequest {
  /** gm 用叙事模型，aux 用辅助模型 */
  readonly purpose: "gm" | "aux";
  readonly messages: readonly LlmMessage[];
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
}

export interface LlmUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export type LlmEvent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "blocked"; readonly reason: string }
  | { readonly type: "done"; readonly finishReason: string; readonly usage?: LlmUsage };

export interface LlmClient {
  stream(request: LlmRequest, signal?: AbortSignalLike): AsyncIterable<LlmEvent>;
}
