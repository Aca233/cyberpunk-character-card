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

/** OpenAI 兼容接口（/chat/completions）：OpenAI 本身、New API 一类中转站、Ollama 都走这里 */

const DEFAULT_BASE: Record<"openai" | "ollama", string> = {
  openai: "https://api.openai.com/v1",
  ollama: "http://127.0.0.1:11434/v1",
};

/** 上游把内容拦下时常见的错误码；遇到这些转成 blocked，不当成网络错误重试 */
const BLOCK_CODES = new Set([
  "content_filter",
  "content_policy_violation",
  "safety",
  "sensitive_words_detected",
]);

/** 有的中转站在上游失败时仍回 200，把错误写成正文，例如 `[Upstream Error 500]: {...}` */
const UPSTREAM_ERROR_TEXT = /^\s*\[Upstream Error (\d{3})\]\s*:?\s*/i;
/** 攒够这么多字再判断开头是不是错误；正常正文只晚这一点点放出 */
const HEAD_CHECK = 24;

interface ChatChunk {
  readonly choices?: readonly {
    readonly delta?: {
      readonly content?: string | null;
      readonly reasoning_content?: string | null;
      readonly reasoning?: string | null;
      readonly thinking?: string | null;
    };
    readonly finish_reason?: string | null;
  }[];
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
    readonly prompt_tokens_details?: { readonly cached_tokens?: number } | null;
    readonly prompt_cache_hit_tokens?: number;
    readonly cache_read_input_tokens?: number;
    readonly cache_creation_input_tokens?: number;
  } | null;
  readonly error?: {
    readonly message?: unknown;
    readonly code?: string | number | null;
    readonly type?: string | number | null;
  };
}

function normalizeErrorField(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function hostOf(profile: Profile): string | undefined {
  if (!profile.baseUrl) return profile.type === "openai" ? "api.openai.com" : undefined;
  try {
    return new URL(profile.baseUrl).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function isOfficialOpenAi(profile: Profile): boolean {
  return profile.type === "openai" && hostOf(profile) === "api.openai.com";
}

function isOpenRouter(profile: Profile): boolean {
  return profile.type === "openai" && hostOf(profile) === "openrouter.ai";
}

/** 仅向官方 OpenAI 或用户显式开启 promptCacheMode:"on" 的非 Claude 端点附加 prompt_cache_key */
function supportsPromptCacheKey(profile: Profile): boolean {
  if (profile.type !== "openai" || profile.promptCacheMode === "off") return false;
  if (isOfficialOpenAi(profile)) return true;
  return profile.promptCacheMode === "on" && !/claude/i.test(profile.model);
}

/** OpenRouter 或用户显式开启的中转站 Claude 模型支持在 OpenAI 兼容消息块上透传 cache_control（不改消息顺序与预设深度） */
function relayClaudeCacheControl(
  profile: Profile,
): { readonly type: "ephemeral"; readonly ttl?: "1h" } | undefined {
  if (profile.type !== "openai" || profile.promptCacheMode === "off") return undefined;
  if (!/claude/i.test(profile.model)) return undefined;
  if (profile.promptCacheMode !== "on" && !isOpenRouter(profile)) return undefined;
  return profile.cacheTtl === "1h" ? { type: "ephemeral", ttl: "1h" } : { type: "ephemeral" };
}

const SEMI_STATIC_SYSTEM_PREFIX = /^(?:【前情】|【最近几轮)/;

export function chatCompletionsUrl(profile: Profile): string {
  const base = profile.baseUrl ?? DEFAULT_BASE[profile.type === "ollama" ? "ollama" : "openai"];
  return `${base.replace(/\/+$/, "")}/chat/completions`;
}

/** 把写成正文的上游错误转成报错；取出状态码和 message，原文只留开头一段 */
function textAsError(provider: string, text: string): UpstreamError {
  const match = UPSTREAM_ERROR_TEXT.exec(text);
  const status = Number(match?.[1] ?? 502);
  const rest = text.slice(match?.[0].length ?? 0).trim();
  let detail = rest.slice(0, 200);
  try {
    const json = JSON.parse(rest) as { message?: unknown };
    if (typeof json.message === "string" && json.message !== "") detail = json.message;
  } catch {
    // 不是 JSON 就用原文开头
  }
  return new UpstreamError(
    `${provider} 的上游服务出错（${status}）：${detail}。这是中转站那边的问题，可以稍后重试，或在中转站后台检查渠道`,
    status,
    status >= 500 || status === 429,
  );
}

export function openAiClient(profile: Profile, apiKey: string | undefined): LlmClient {
  const provider = `方案「${profile.name}」`;
  return {
    async *stream(request: LlmRequest, signalLike?: AbortSignalLike): AsyncGenerator<LlmEvent> {
      const signal = toAbortSignal(signalLike);
      if (signal?.aborted) throw new AbortedError();
      const maxTokens = request.maxOutputTokens ?? profile.maxOutputTokens;
      const temperature = request.temperature ?? profile.temperature;
      const relayCache = relayClaudeCacheControl(profile);
      // 严禁重排消息顺序或修改预设注入深度；只在原位为静态 system 末尾、半静态前情与历史末尾附带 cache_control。
      let lastStaticSystemIdx = -1;
      let recapSystemIdx = -1;
      let lastRecentSystemIdx = -1;
      if (relayCache) {
        let inSemi = false;
        for (let i = 0; i < request.messages.length; i += 1) {
          const msg = request.messages[i];
          if (msg?.role !== "system" || msg.content.trim() === "") continue;
          if (!inSemi && !SEMI_STATIC_SYSTEM_PREFIX.test(msg.content)) {
            lastStaticSystemIdx = i;
          } else {
            inSemi = true;
            if (recapSystemIdx < 0 && msg.content.startsWith("【前情】")) recapSystemIdx = i;
            lastRecentSystemIdx = i;
          }
        }
      }
      const nonSystemCount = request.messages.filter((m) => m.role !== "system").length;
      const historyTailIdx = relayCache && nonSystemCount >= 3 ? request.messages.length - 2 : -1;
      const body = {
        model: profile.model,
        messages: request.messages.map((m: LlmMessage, idx: number) => {
          const markCache =
            relayCache !== undefined &&
            (idx === lastStaticSystemIdx ||
              idx === recapSystemIdx ||
              (historyTailIdx < 0 && idx === lastRecentSystemIdx) ||
              idx === historyTailIdx);
          if (m.role === "user" && m.images?.length) {
            return {
              role: m.role,
              content: [
                ...m.images.map((img) => ({
                  type: "image_url" as const,
                  image_url: { url: `data:${img.mimeType};base64,${img.data}` },
                })),
                {
                  type: "text" as const,
                  text: m.content,
                  ...(markCache ? { cache_control: relayCache } : {}),
                },
              ],
            };
          }
          if (markCache) {
            return {
              role: m.role,
              content: [{ type: "text" as const, text: m.content, cache_control: relayCache }],
            };
          }
          return { role: m.role, content: m.content };
        }),
        stream: true,
        stream_options: { include_usage: true },
        ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
        ...(temperature !== undefined ? { temperature } : {}),
        // baseUrl 留空也可能走官方接口，不能用它与默认地址的字符串比较判断支持情况。
        ...(request.topP !== undefined ? { top_p: request.topP } : {}),
        ...(request.responseFormat?.type === "json"
          ? { response_format: { type: "json_object" } }
          : {}),
        ...(request.cacheKey && supportsPromptCacheKey(profile)
          ? { prompt_cache_key: request.cacheKey }
          : {}),
        ...(isOfficialOpenAi(profile) && profile.cacheTtl === "24h"
          ? { prompt_cache_retention: "24h" }
          : {}),
      };
      const headers: Record<string, string> = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
      const res = await post(provider, chatCompletionsUrl(profile), headers, body, signal);
      if (!res.ok) {
        const detail = await errorDetail(res);
        if (signal?.aborted) throw new AbortedError();
        const detailCode = normalizeErrorField(detail.code);
        if (detailCode && BLOCK_CODES.has(detailCode.toLowerCase())) {
          yield { type: "blocked", reason: detail.message || "上游拦截了这段内容" };
          return;
        }
        throw statusError(provider, res.status, detail.message);
      }
      if (!res.body) throw new UpstreamError(`${provider} 没有返回内容`, res.status, true);

      let finishReason = "";
      let usage: LlmUsage | undefined;
      let finished = false;
      // 开头先攒住，确认不是写成正文的上游错误再放出去；是错误就一直攒到结束再报
      let head = "";
      let headState: "pending" | "story" | "error" = "pending";
      for await (const event of readSse(provider, res.body, signal)) {
        if (event.data === "[DONE]") {
          finished = true;
          break;
        }
        let chunk: ChatChunk;
        try {
          chunk = JSON.parse(event.data) as ChatChunk;
        } catch {
          throw new UpstreamError(`${provider} 返回了看不懂的数据`, undefined, true);
        }
        if (chunk.error) {
          const code =
            normalizeErrorField(chunk.error.code) || normalizeErrorField(chunk.error.type);
          const msg = normalizeErrorField(chunk.error.message);
          if (code && BLOCK_CODES.has(code.toLowerCase())) {
            yield { type: "blocked", reason: msg || "上游拦截了这段内容" };
            return;
          }
          const numericCode =
            typeof chunk.error.code === "number" && Number.isInteger(chunk.error.code)
              ? chunk.error.code
              : /^\d{3}$/.test(code)
                ? Number(code)
                : undefined;
          if (numericCode !== undefined && numericCode >= 400 && numericCode <= 599) {
            throw statusError(provider, numericCode, msg);
          }
          throw new UpstreamError(
            `${provider} 生成到一半出错：${msg || code || "未知错误"}`,
            undefined,
            true,
          );
        }
        for (const choice of chunk.choices ?? []) {
          const thought =
            choice.delta?.reasoning_content ?? choice.delta?.reasoning ?? choice.delta?.thinking;
          if (thought) yield { type: "thought", text: thought };
          const text = choice.delta?.content;
          if (text) {
            if (headState === "story") {
              yield { type: "text", text };
            } else {
              head += text;
              if (headState === "pending" && head.trimStart().length >= HEAD_CHECK) {
                headState = UPSTREAM_ERROR_TEXT.test(head) ? "error" : "story";
                if (headState === "story") yield { type: "text", text: head };
              }
            }
          }
          if (choice.finish_reason) finishReason = choice.finish_reason;
        }
        if (chunk.usage) {
          const cached =
            chunk.usage.prompt_tokens_details?.cached_tokens ??
            chunk.usage.prompt_cache_hit_tokens ??
            chunk.usage.cache_read_input_tokens ??
            0;
          const write = chunk.usage.cache_creation_input_tokens ?? 0;
          usage = {
            inputTokens: chunk.usage.prompt_tokens ?? 0,
            outputTokens: chunk.usage.completion_tokens ?? 0,
            ...(cached > 0 ? { cachedInputTokens: cached } : {}),
            ...(write > 0 ? { cacheWriteTokens: write } : {}),
          };
        }
      }
      if (headState !== "story" && UPSTREAM_ERROR_TEXT.test(head))
        throw textAsError(provider, head);
      if (headState === "pending" && head !== "") yield { type: "text", text: head };
      if (finishReason === "content_filter" || finishReason === "refusal") {
        yield { type: "blocked", reason: "上游在生成途中拦截了这段内容" };
        return;
      }
      if (!finished && !finishReason)
        throw new UpstreamError(`${provider} 的回复没有正常结束`, undefined, true);
      yield { type: "done", finishReason: finishReason || "stop", ...(usage ? { usage } : {}) };
    },
  };
}
