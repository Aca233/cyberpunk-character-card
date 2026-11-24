import type {
  AbortSignalLike,
  LlmClient,
  LlmEvent,
  LlmMessage,
  LlmMessageImage,
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
const DEFAULT_MAX_TOKENS = 8192;

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
    readonly thinking?: string;
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

interface AnthropicImageBlock {
  readonly type: "image";
  readonly source: {
    readonly type: "base64";
    readonly media_type: LlmMessageImage["mimeType"];
    readonly data: string;
  };
}

type AnthropicContentBlock = AnthropicTextBlock | AnthropicImageBlock;

interface AnthropicTurn {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
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
 * 为最大化 Prompt Caching 命中率（最多 3 处断点，低于 Anthropic 4 断点上限）：
 * - 断点 1：system 顶层静态规则 + 静态表整段缓存；
 * - 断点 2 & 3：多轮对话时在倒数第 2 条（历史末尾）与倒数第 4 条（上一轮历史断点）各打一个滚动断点，
 *   兼顾原生 20-block lookback 与不支持回溯的第三方中转站；
 * - 相邻同角色消息合并时保留独立 text block，确保酒馆尾部 assistant 条目不会改动前一条历史 assistant 块。
 */
function buildMessages(
  messages: readonly LlmMessage[],
  jsonMode: boolean,
): {
  readonly system?: AnthropicTextBlock[];
  readonly messages: AnthropicTurn[];
} {
  const systems: string[] = [];
  const turns: { role: "user" | "assistant"; parts: string[]; images: LlmMessageImage[] }[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      if (m.content.trim() !== "") systems.push(m.content);
      continue;
    }
    const msgImages = m.role === "user" && m.images?.length ? [...m.images] : [];
    const last = turns[turns.length - 1];
    if (last && last.role === m.role) {
      if (m.content !== "") last.parts.push(m.content);
      if (msgImages.length > 0) last.images.push(...msgImages);
    } else {
      turns.push({ role: m.role, parts: m.content !== "" ? [m.content] : [], images: msgImages });
    }
  }
  if (turns.length === 0 || turns[0]?.role !== "user") {
    turns.unshift({ role: "user", parts: ["请开始。"], images: [] });
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

  // 多轮对话时在倒数第 2 条与倒数第 4 条打滚动断点，最新一条 user 动态上下文紧随其后
  const outTurns: AnthropicTurn[] = turns.map((turn, index) => {
    const isCacheBreakpoint =
      (turns.length >= 3 && index === turns.length - 2) ||
      (turns.length >= 5 && index === turns.length - 4);
    const nonEmptyParts = turn.parts.filter((p) => p.trim() !== "");
    if (turn.images.length > 0) {
      const blocks: AnthropicContentBlock[] = [
        ...turn.images.map(
          (img): AnthropicImageBlock => ({
            type: "image",
            source: { type: "base64", media_type: img.mimeType, data: img.data },
          }),
        ),
        ...(nonEmptyParts.length > 0
          ? nonEmptyParts.map(
              (text, partIndex): AnthropicTextBlock => ({
                type: "text",
                text,
                ...(isCacheBreakpoint && partIndex === 0 ? { cache_control: EPHEMERAL } : {}),
              }),
            )
          : [
              {
                type: "text" as const,
                text: "请观察图片。",
                ...(isCacheBreakpoint ? { cache_control: EPHEMERAL } : {}),
              },
            ]),
      ];
      return { role: turn.role, content: blocks };
    }
    if (nonEmptyParts.length === 0) {
      return { role: turn.role, content: "" };
    }
    if (isCacheBreakpoint) {
      // 若同角色合并了多段（例如历史 assistant + 酒馆尾部 assistant 条目），断点打在第 0 块（稳定历史原文）上
      return {
        role: turn.role,
        content: nonEmptyParts.map(
          (text, partIndex): AnthropicTextBlock => ({
            type: "text",
            text,
            ...(partIndex === 0 ? { cache_control: EPHEMERAL } : {}),
          }),
        ),
      };
    }
    return nonEmptyParts.length === 1
      ? { role: turn.role, content: nonEmptyParts[0] ?? "" }
      : {
          role: turn.role,
          content: nonEmptyParts.map((text): AnthropicTextBlock => ({ type: "text", text })),
        };
  });

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
        ...(request.cacheKey ? { metadata: { user_id: request.cacheKey } } : {}),
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
        if (signal?.aborted) throw new AbortedError();
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

      // 部分中转站在 message_delta 里会把 input_tokens / cache_* 填成 0，用 Math.max 避免冲掉 message_start 的真实缓存命中数
      const absorbUsage = (u: AnthropicUsage) => {
        if (u.input_tokens !== undefined) inputTokens = Math.max(inputTokens, u.input_tokens);
        if (u.output_tokens !== undefined) outputTokens = Math.max(outputTokens, u.output_tokens);
        if (u.cache_read_input_tokens !== undefined) {
          cachedInputTokens = Math.max(cachedInputTokens, u.cache_read_input_tokens);
        }
        if (u.cache_creation_input_tokens !== undefined) {
          cacheWriteTokens = Math.max(cacheWriteTokens, u.cache_creation_input_tokens);
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
        } else if (kind === "content_block_delta" && payload.delta?.type === "thinking_delta") {
          const thinking = payload.delta.thinking;
          if (thinking) yield { type: "thought", text: thinking };
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
