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

interface AnthropicCacheControl {
  readonly type: "ephemeral";
  readonly ttl?: "5m" | "1h";
}

interface AnthropicTextBlock {
  readonly type: "text";
  readonly text: string;
  readonly cache_control?: AnthropicCacheControl;
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

function cacheControlFor(profile: Profile): AnthropicCacheControl | undefined {
  if (profile.promptCacheMode === "off") return undefined;
  if (profile.cacheTtl === "1h") return { type: "ephemeral", ttl: "1h" };
  return { type: "ephemeral" };
}

export function anthropicMessagesUrl(profile: Profile): string {
  const base = (profile.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
  if (base.endsWith("/messages")) return base;
  if (base.endsWith("/v1")) return `${base}/messages`;
  return `${base}/v1/messages`;
}

/**
 * Anthropic 要求 system 单独顶层传入，且 messages 只能是交替的 user/assistant，首条须为 user。
 * 为最大化 Prompt Caching 命中率（总断点数始终 ≤ 3，低于 Anthropic 4 断点上限）：
 * - 静态 system（规则、常驻模块、静态目录表与前置预设）合并为首块并打断点 1；
 * - 半静态 system（【前情】摘要与 judge 步长对齐的【最近几轮】逐轮块）保持独立文本块，
 *   分别在【前情】与末条近期块上打断点，使同场景与同步长内稳定命中缓存且不击穿静态块；
 * - 若有多轮历史对话（turns.length >= 3），在倒数第二条（历史末尾）再打历史断点。
 */
const SEMI_STATIC_SYSTEM_PREFIX = /^(?:【前情】|【最近几轮)/;

function buildMessages(
  messages: readonly LlmMessage[],
  jsonMode: boolean,
  cacheControl: AnthropicCacheControl | undefined,
): {
  readonly system?: AnthropicTextBlock[];
  readonly messages: AnthropicTurn[];
} {
  const staticSystems: string[] = [];
  const semiStaticSystems: string[] = [];
  const turns: { role: "user" | "assistant"; content: string; images: LlmMessageImage[] }[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      if (m.content.trim() === "") continue;
      if (semiStaticSystems.length > 0 || SEMI_STATIC_SYSTEM_PREFIX.test(m.content)) {
        semiStaticSystems.push(m.content);
      } else {
        staticSystems.push(m.content);
      }
      continue;
    }
    const msgImages = m.role === "user" && m.images?.length ? [...m.images] : [];
    const last = turns[turns.length - 1];
    if (last && last.role === m.role) {
      last.content = `${last.content}\n\n${m.content}`;
      if (msgImages.length > 0) last.images.push(...msgImages);
    } else {
      turns.push({ role: m.role, content: m.content, images: msgImages });
    }
  }
  if (turns.length === 0 || turns[0]?.role !== "user") {
    turns.unshift({ role: "user", content: "请开始。", images: [] });
  }
  const staticText = [
    ...staticSystems,
    ...(jsonMode ? ["只输出合法 JSON 对象，不要包含解释文字或 Markdown 代码块围栏。"] : []),
  ]
    .filter(Boolean)
    .join("\n\n");
  const systemBlocks: AnthropicTextBlock[] = [];
  if (staticText) {
    systemBlocks.push(
      cacheControl
        ? { type: "text", text: staticText, cache_control: cacheControl }
        : { type: "text", text: staticText },
    );
  }
  const hasHistoryBreakpoint = cacheControl !== undefined && turns.length >= 3;
  const recapIndex = semiStaticSystems.findIndex((text) => text.startsWith("【前情】"));
  const lastSemiIndex = semiStaticSystems.length - 1;
  for (const [idx, text] of semiStaticSystems.entries()) {
    // 【前情】独立打断点（跨历史滑窗仍能命中）；无对话历史断点时（如 judge）再在最后一块近期原文打断点
    const markRecap = cacheControl !== undefined && idx === recapIndex;
    const markRecentTail =
      cacheControl !== undefined && !hasHistoryBreakpoint && idx === lastSemiIndex;
    systemBlocks.push(
      (markRecap || markRecentTail) && cacheControl
        ? { type: "text", text, cache_control: cacheControl }
        : { type: "text", text },
    );
  }
  const system: AnthropicTextBlock[] | undefined =
    systemBlocks.length > 0 ? systemBlocks : undefined;

  // 多轮对话时把历史最后一条（倒数第 2 条）标为缓存断点，最新一条 user 动态上下文紧随其后
  const outTurns: AnthropicTurn[] = turns.map((turn, index) => {
    const isCacheBreakpoint = hasHistoryBreakpoint && index === turns.length - 2;
    if (turn.images.length > 0) {
      const blocks: AnthropicContentBlock[] = [
        ...turn.images.map(
          (img): AnthropicImageBlock => ({
            type: "image",
            source: { type: "base64", media_type: img.mimeType, data: img.data },
          }),
        ),
        {
          type: "text",
          text: turn.content || "请观察图片。",
          ...(isCacheBreakpoint && cacheControl ? { cache_control: cacheControl } : {}),
        },
      ];
      return { role: turn.role, content: blocks };
    }
    return isCacheBreakpoint && cacheControl
      ? {
          role: turn.role,
          content: [{ type: "text", text: turn.content, cache_control: cacheControl }],
        }
      : { role: turn.role, content: turn.content };
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
        cacheControlFor(profile),
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
