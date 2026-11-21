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

export interface LlmResponseFormat {
  readonly type: "json";
  readonly name?: string;
  readonly schema?: Record<string, unknown>;
}

export interface LlmRequest {
  /** narrator 用叙事模型，aux 用辅助模型 */
  readonly purpose: "narrator" | "aux";
  readonly messages: readonly LlmMessage[];
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
  /** 酒馆预设带来的采样参数（只给叙事模型）；服务商不支持的由各家适配层忽略 */
  readonly topP?: number;
  readonly topK?: number;
  /** 开启服务商原生结构化 JSON 输出（纯文本流式叙事不传） */
  readonly responseFormat?: LlmResponseFormat;
  /** 可选提示缓存路由键（如存档 id + 阶段），供支持 prompt_cache_key 的服务商稳定命中同一缓存桶 */
  readonly cacheKey?: string;
}

export interface LlmUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** 本次请求命中提示词缓存的输入 token 数（含 Anthropic cache_read / OpenAI cached_tokens / Gemini cachedContentTokenCount） */
  readonly cachedInputTokens?: number | undefined;
  /** 本次请求写入提示词缓存的输入 token 数（Anthropic cache_creation_input_tokens） */
  readonly cacheWriteTokens?: number | undefined;
}

export type LlmEvent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "blocked"; readonly reason: string }
  | { readonly type: "done"; readonly finishReason: string; readonly usage?: LlmUsage };

export interface LlmClient {
  stream(request: LlmRequest, signal?: AbortSignalLike): AsyncIterable<LlmEvent>;
}

/** 可选向量嵌入客户端：用于旧记忆语义检索，未配置或失败时自动退化为规则检索 */
export interface Embedder {
  embed(
    texts: readonly string[],
    signal?: AbortSignalLike,
  ): Promise<readonly (readonly number[])[]>;
}
