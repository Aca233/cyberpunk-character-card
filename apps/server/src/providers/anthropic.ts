import type {
  AbortSignalLike,
  LlmClient,
  LlmEvent,
  LlmMessage,
  LlmRequest,
  LlmUsage,
} from "@cp/core";
import type { Profile } from "../config";
import {
  AbortedError,
  errorDetail,
  post,
  readSse,
  statusError,
  toAbortSignal,
  UpstreamError,
} from "./http";

/** Anthropic 原生 Messages API（/v1/messages）流式接入 */

const DEFAULT_BASE = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 4096;

interface AnthropicUsage {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly cache_read_input_tokens?: number;
  readonly cache_creation_input_tokens?: number;
}

interface AnthropicEvent {
  readonly type?: string;
  readonly message?: {
    readonly usage?: AnthropicUsage;
  };
  readonly delta?: {
    readonly type?: string;
    readonly text?: string;
    readonly stop_reason?: string | null;
  };
  readonly usage?: AnthropicUsage;
  readonly error?: {
    readonly type?: string;
    readonly message?: string;
  };
}

interface AnthropicTextBlock {
  readonly type: "text";
  readonly text: string;
  readonly cache_control?: { readonly type: "ephemeral" };
}

interface AnthropicTurn {
  role: "user" | "assistant";
  content: string | AnthropicTextBlock[];
}

const EPHEMERAL = { type: "ephemeral" } as const;

export function anthropicMessagesUrl(profile: Profile): string {
  const base = (profile.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
  if (base.endsWith("/messages")) return base;
  if (base.endsWith("/v1")) return `${base}/messages`;
  return `${base}/v1/messages`;
}

/**
 * Anthropic 要求 system 单独顶层传入，且 messages 只能是交替的 user/assistant，首条须为 user。
 * 为提升 Prompt Caching 命中率：
 * - system 拆成内容块数组并在最后一块打 cache_control（静态规则 + 静态表整段缓存）；
 * - 若有多轮历史对话（turns.length >= 3），在倒数第二条（历史末尾）再打第二个 cache_control 断点，
 *   让历史对话前缀也能跨轮复用缓存。
 */
function buildMessages(
  messages: readonly LlmMessage[],
  jsonMode: boolean,
): {
  readonly system?: AnthropicTextBlock[];
  readonly messages: AnthropicTurn[];
} {
  const systems: string[] = [];
  const turns: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      if (m.content.trim() !== "") systems.push(m.content);
      continue;
    }
    const last = turns[turns.length - 1];
    if (last && last.role === m.role) {
      last.content = `${last.content}\n\n${m.content}`;
    } else {
      turns.push({ role: m.role, content: m.content });
    }
  }
  if (turns.length === 0 || turns[0]?.role !== "user") {
    turns.unshift({ role: "user", content: "请开始。" });
  }
  const systemText = [
    ...systems,
    ...(jsonMode ? ["只输出合法 JSON 对象，不要包含解释文字或 Markdown 代码块围栏。"] : []),
  ]
    .filter(Boolean)
    .join("\n\n");
  const system: AnthropicTextBlock[] | undefined = systemText
    ? [{ type: "text", text: systemText, cache_control: EPHEMERAL }]
    : undefined;

  // 多轮对话时把历史最后一条（倒数第 2 条）标为缓存断点，最新一条 user 动态上下文紧随其后
  const outTurns: AnthropicTurn[] = turns.map((turn, index) =>
    turns.length >= 3 && index === turns.length - 2
      ? {
          role: turn.role,
          content: [{ type: "text", text: turn.content, cache_control: EPHEMERAL }],
        }
      : { role: turn.role, content: turn.content },
  );

  return system ? { system, messages: outTurns } : { messages: outTurns };
}

export function anthropicClient(profile: Profile, apiKey: string): LlmClient {
  const provider = `方案「${profile.name}」`;
  return {
    async *stream(request: LlmRequest, signalLike?: AbortSignalLike): AsyncGenerator<LlmEvent> {
      const signal = toAbortSignal(signalLike);
      if (signal?.aborted) throw new AbortedError();
      const maxTokens = request.maxOutputTokens ?? profile.maxOutputTokens ?? DEFAULT_MAX_TOKENS;
      const temperature = request.temperature ?? profile.temperature;
      const { system, messages } = buildMessages(
        request.messages,
        request.responseFormat?.type === "json",
      );
      const body: Record<string, unknown> = {
        model: profile.model,
        max_tokens: maxTokens,
        messages,
        stream: true,
        ...(system ? { system } : {}),
        // Anthropic Claude 4.x+ 不允许同时传 temperature 和 top_p，优先采用 temperature
        ...(temperature !== undefined
          ? { temperature }
          : request.topP !== undefined
            ? { top_p: request.topP }
            : {}),
        ...(request.topK !== undefined ? { top_k: request.topK } : {}),
      };
      const res = await post(
        provider,
        anthropicMessagesUrl(profile),
        {
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body,
        signal,
      );
      if (!res.ok) {
        const detail = await errorDetail(res);
        throw statusError(provider, res.status, detail.message);
      }
      if (!res.body) throw new UpstreamError(`${provider} 没有返回内容`, res.status, true);

      let inputTokens = 0;
      let outputTokens = 0;
      let cachedInputTokens = 0;
      let cacheWriteTokens = 0;
      let hasUsage = false;
      let finishReason = "";
      let stopped = false;

      const absorbUsage = (u: AnthropicUsage) => {
        if (u.input_tokens !== undefined) inputTokens = u.input_tokens;
        if (u.output_tokens !== undefined) outputTokens = u.output_tokens;
        if (u.cache_read_input_tokens !== undefined) {
          cachedInputTokens = u.cache_read_input_tokens;
        }
        if (u.cache_creation_input_tokens !== undefined) {
          cacheWriteTokens = u.cache_creation_input_tokens;
        }
        hasUsage = true;
      };

      for await (const event of readSse(provider, res.body, signal)) {
        if (!event.data || event.data === "[DONE]") continue;
        let payload: AnthropicEvent;
        try {
          payload = JSON.parse(event.data) as AnthropicEvent;
        } catch {
          throw new UpstreamError(`${provider} 返回了看不懂的数据`, undefined, true);
        }
        const kind = payload.type ?? event.event ?? "";
        if (kind === "error" || payload.error) {
          const msg = payload.error?.message ?? payload.error?.type ?? "未知上游错误";
          const retryable =
            payload.error?.type === "overloaded_error" ||
            payload.error?.type === "rate_limit_error" ||
            payload.error?.type === "api_error";
          throw new UpstreamError(`${provider} 生成出错：${msg}`, undefined, retryable);
        }
        if (kind === "message_start" && payload.message?.usage) {
          absorbUsage(payload.message.usage);
        } else if (kind === "content_block_delta" && payload.delta?.type === "text_delta") {
          const text = payload.delta.text;
          if (text) yield { type: "text", text };
        } else if (kind === "message_delta") {
          if (payload.delta?.stop_reason) finishReason = payload.delta.stop_reason;
          if (payload.usage) absorbUsage(payload.usage);
        } else if (kind === "message_stop") {
          stopped = true;
          break;
        }
      }

      if (finishReason === "refusal") {
        yield { type: "blocked", reason: "Anthropic 拒绝回答这段内容" };
        return;
      }
      if (!stopped && !finishReason) {
        throw new UpstreamError(`${provider} 的回复没有正常结束`, undefined, true);
      }
      // Anthropic 的 input_tokens 只含未命中缓存的部分；总输入应加回 cache_read 与 cache_creation，
      // 与 OpenAI prompt_tokens / Gemini promptTokenCount 口径保持一致，便于统一计算缓存命中率。
      const totalInputTokens = inputTokens + cachedInputTokens + cacheWriteTokens;
      const usage: LlmUsage | undefined = hasUsage
        ? {
            inputTokens: totalInputTokens,
            outputTokens,
            ...(cachedInputTokens > 0 ? { cachedInputTokens } : {}),
            ...(cacheWriteTokens > 0 ? { cacheWriteTokens } : {}),
          }
        : undefined;
      yield {
        type: "done",
        finishReason: finishReason || "end_turn",
        ...(usage ? { usage } : {}),
      };
    },
  };
}
