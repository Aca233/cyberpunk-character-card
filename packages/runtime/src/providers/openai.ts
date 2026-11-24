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
    readonly input_tokens?: number;
    readonly output_tokens?: number;
    readonly prompt_tokens_details?: {
      readonly cached_tokens?: number;
      readonly cache_read_tokens?: number;
      readonly cache_read_input_tokens?: number;
      readonly cache_write_tokens?: number;
      readonly cache_creation_input_tokens?: number;
    } | null;
    readonly input_tokens_details?: { readonly cached_tokens?: number } | null;
    readonly prompt_cache_hit_tokens?: number;
    readonly cache_read_input_tokens?: number;
    readonly cache_creation_input_tokens?: number;
    readonly cached_tokens?: number;
  } | null;
  readonly error?: {
    readonly message?: string;
    readonly code?: string | null;
    readonly type?: string;
  };
}

const EPHEMERAL = { type: "ephemeral" } as const;

/** 记录明确返回 400 拒绝 prompt_cache_key / user 字段的上游端点，后续请求自动省略对应字段 */
const rejectedCacheKeyEndpoints = new Set<string>();
const rejectedUserFieldEndpoints = new Set<string>();

function endpointKey(profile: Profile): string {
  return `${profile.baseUrl ?? DEFAULT_BASE.openai}::${profile.model}`;
}

function isGoogleDirectOpenAiCompat(profile: Profile): boolean {
  if (!profile.baseUrl) return false;
  try {
    return new URL(profile.baseUrl).hostname.toLowerCase() === "generativelanguage.googleapis.com";
  } catch {
    return false;
  }
}

/**
 * 向 OpenAI 官方与各类兼容中转站（New API / One API / Sub2API / agg-direct / OpenRouter 等）
 * 透传 prompt_cache_key 与 user，使聚合多号网关能按「存档会话」做统一粘性路由（与 Codex 机制一致），
 * 避免轮询切号或跨阶段拆分账号导致上游隐式缓存失效。仅跳过 Ollama 与严格校验未知字段的 Google 官方 OpenAI 兼容端点。
 */
function supportsPromptCacheKey(profile: Profile): boolean {
  if (profile.type !== "openai") return false;
  if (isGoogleDirectOpenAiCompat(profile)) return false;
  return !rejectedCacheKeyEndpoints.has(endpointKey(profile));
}

function supportsUserStickyField(profile: Profile): boolean {
  if (profile.type !== "openai") return false;
  if (isGoogleDirectOpenAiCompat(profile)) return false;
  return !rejectedUserFieldEndpoints.has(endpointKey(profile));
}

function isRejectedFieldError(status: number, message: string, field: string): boolean {
  if (status !== 400 && status !== 422) return false;
  const lower = message.toLowerCase();
  if (!lower.includes(field.toLowerCase())) return false;
  return (
    lower.includes("unknown") ||
    lower.includes("unrecognized") ||
    lower.includes("unexpected") ||
    lower.includes("unsupported") ||
    lower.includes("extra_forbidden") ||
    lower.includes("additional properties") ||
    lower.includes("not permitted") ||
    lower.includes("invalid")
  );
}

/**
 * 通过 OpenAI 兼容接口（New API / One API / OpenRouter / LiteLLM 等）调用 Claude 时，
 * 上游 Anthropic 协议要求显式 cache_control 断点，否则提示词缓存命中率恒为 0%；
 * OpenRouter 调用 Gemini 时同样支持通过 cache_control 启用显式缓存。
 * 对纯 OpenAI / DeepSeek / 通义 / Ollama 等自动缓存或不支持该字段的后端不发送，避免 400 报错。
 */
function supportsExplicitCacheControl(profile: Profile): boolean {
  if (profile.type !== "openai") return false;
  const model = profile.model.toLowerCase();
  if (model.includes("claude")) return true;
  if (profile.baseUrl && model.includes("gemini")) {
    try {
      const host = new URL(profile.baseUrl).hostname.toLowerCase();
      if (host === "openrouter.ai" || host.endsWith(".openrouter.ai")) return true;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * 合并连续的前导 system 消息（例如酒馆预设的 20+ 条静态 system 条目 + 本作静态规则）为单条 system 消息，
 * 避免部分 OpenAI→Gemini / OpenAI→Claude 协议转换中转站对多条 system 消息处理不一致而破坏前缀缓存。
 */
function normalizeLeadingSystem(messages: readonly LlmMessage[]): LlmMessage[] {
  const leading: string[] = [];
  let idx = 0;
  while (idx < messages.length) {
    const m = messages[idx];
    if (m?.role !== "system") break;
    if (m.content.trim() !== "") leading.push(m.content);
    idx += 1;
  }
  if (idx <= 1) return [...messages];
  return [
    ...(leading.length > 0 ? [{ role: "system" as const, content: leading.join("\n\n") }] : []),
    ...messages.slice(idx),
  ];
}

/** 计算 OpenAI 兼容消息列表里应打 cache_control 断点的下标（最多 3 处：系统前缀末尾 + 最近两轮历史断点）。 */
function cacheBreakpointIndices(messages: readonly LlmMessage[]): Set<number> {
  const indices = new Set<number>();
  // 断点 1：前导 system 消息（已合并酒馆静态预设 + 本作静态规则与静态表）
  if (messages[0]?.role === "system" && messages[0].content.trim() !== "") {
    indices.add(0);
  }

  // 断点 2 & 3：多轮对话时在倒数第 2 条与倒数第 4 条非 system 消息上打滚动断点，
  // 既写入本轮最新历史缓存，也能在未实现 20-block lookback 的中转站上稳定命中上一轮缓存。
  const nonSystem: number[] = [];
  for (let i = 0; i < messages.length; i += 1) {
    const m = messages[i];
    if (m && m.role !== "system" && m.content.trim() !== "") nonSystem.push(i);
  }
  if (nonSystem.length >= 3) {
    const recent = nonSystem[nonSystem.length - 2];
    if (recent !== undefined) indices.add(recent);
  }
  if (nonSystem.length >= 5) {
    const prev = nonSystem[nonSystem.length - 4];
    if (prev !== undefined) indices.add(prev);
  }
  return indices;
}

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
      const normalizedMessages = normalizeLeadingSystem(request.messages);
      const useCacheControl = supportsExplicitCacheControl(profile);
      const breakpoints = useCacheControl ? cacheBreakpointIndices(normalizedMessages) : undefined;
      const buildBody = (includeCacheKey: boolean, includeUser: boolean) => ({
        model: profile.model,
        messages: normalizedMessages.map((m: LlmMessage, index: number) => {
          const markCache = breakpoints?.has(index) === true && m.content.trim() !== "";
          if (m.role === "user" && m.images?.length) {
            return {
              role: m.role,
              content: [
                ...m.images.map((img) => ({
                  type: "image_url" as const,
                  image_url: { url: `data:${img.mimeType};base64,${img.data}` },
                })),
                ...(m.content
                  ? [
                      {
                        type: "text" as const,
                        text: m.content,
                        ...(markCache ? { cache_control: EPHEMERAL } : {}),
                      },
                    ]
                  : []),
              ],
            };
          }
          if (markCache) {
            return {
              role: m.role,
              content: [{ type: "text" as const, text: m.content, cache_control: EPHEMERAL }],
            };
          }
          return { role: m.role, content: m.content };
        }),
        stream: true,
        stream_options: { include_usage: true },
        ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
        ...(temperature !== undefined ? { temperature } : {}),
        // 酒馆预设的 top_p；不能仅凭地址不同就认定上游支持 top_k，未确认能力时不发送扩展字段。
        // baseUrl 留空也可能走官方接口，不能用它与默认地址的字符串比较判断支持情况。
        ...(request.topP !== undefined ? { top_p: request.topP } : {}),
        ...(request.responseFormat?.type === "json"
          ? { response_format: { type: "json_object" } }
          : {}),
        ...(includeCacheKey && request.cacheKey ? { prompt_cache_key: request.cacheKey } : {}),
        ...(includeUser && request.cacheKey ? { user: request.cacheKey } : {}),
      });
      const headers: Record<string, string> = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
      const url = chatCompletionsUrl(profile);
      let includeCacheKey = Boolean(request.cacheKey && supportsPromptCacheKey(profile));
      let includeUser = Boolean(request.cacheKey && supportsUserStickyField(profile));
      let res = await post(provider, url, headers, buildBody(includeCacheKey, includeUser), signal);
      for (
        let attempt = 0;
        attempt < 2 && !res.ok && (includeCacheKey || includeUser);
        attempt += 1
      ) {
        const detail = await errorDetail(res);
        if (signal?.aborted) throw new AbortedError();
        const rejectKey =
          includeCacheKey && isRejectedFieldError(res.status, detail.message, "prompt_cache_key");
        const rejectUser = includeUser && isRejectedFieldError(res.status, detail.message, "user");
        if (!rejectKey && !rejectUser) {
          if (detail.code && BLOCK_CODES.has(detail.code.toLowerCase())) {
            yield { type: "blocked", reason: detail.message || "上游拦截了这段内容" };
            return;
          }
          throw statusError(provider, res.status, detail.message);
        }
        // 参数 schema 校验 400 未进入上游计费或生成，记下不支持的字段后立即降级重发
        const key = endpointKey(profile);
        if (rejectKey) {
          rejectedCacheKeyEndpoints.add(key);
          includeCacheKey = false;
        }
        if (rejectUser) {
          rejectedUserFieldEndpoints.add(key);
          includeUser = false;
        }
        res = await post(provider, url, headers, buildBody(includeCacheKey, includeUser), signal);
      }
      if (!res.ok) {
        const detail = await errorDetail(res);
        if (signal?.aborted) throw new AbortedError();
        if (detail.code && BLOCK_CODES.has(detail.code.toLowerCase())) {
          yield { type: "blocked", reason: detail.message || "上游拦截了这段内容" };
          return;
        }
        throw statusError(provider, res.status, detail.message);
      }
      if (!res.body) throw new UpstreamError(`${provider} 没有返回内容`, res.status, true);

      let finishReason = "";
      let promptTokens = 0;
      let completionTokens = 0;
      let cachedInputTokens = 0;
      let cacheWriteTokens = 0;
      let hasUsage = false;
      let anthropicUncachedStyle = false;
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
          const code = chunk.error.code ?? chunk.error.type ?? "";
          if (BLOCK_CODES.has(code.toLowerCase())) {
            yield { type: "blocked", reason: chunk.error.message || "上游拦截了这段内容" };
            return;
          }
          throw new UpstreamError(
            `${provider} 生成到一半出错：${chunk.error.message ?? code}`,
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
          const u = chunk.usage;
          const details = u.prompt_tokens_details;
          const inTok = u.prompt_tokens ?? u.input_tokens;
          const outTok = u.completion_tokens ?? u.output_tokens;
          const cached =
            details?.cached_tokens ??
            details?.cache_read_tokens ??
            details?.cache_read_input_tokens ??
            u.input_tokens_details?.cached_tokens ??
            u.prompt_cache_hit_tokens ??
            u.cache_read_input_tokens ??
            u.cached_tokens;
          const write =
            u.cache_creation_input_tokens ??
            details?.cache_write_tokens ??
            details?.cache_creation_input_tokens;
          if (inTok !== undefined) promptTokens = Math.max(promptTokens, inTok);
          if (outTok !== undefined) completionTokens = Math.max(completionTokens, outTok);
          if (cached !== undefined) cachedInputTokens = Math.max(cachedInputTokens, cached);
          if (write !== undefined) cacheWriteTokens = Math.max(cacheWriteTokens, write);
          // 部分中转站直接透传 Anthropic 原生字段（prompt_tokens 仅含未命中部分），需要加回缓存 token 才与总输入口径一致
          if (
            details?.cached_tokens === undefined &&
            (u.cache_read_input_tokens !== undefined || u.cache_creation_input_tokens !== undefined)
          ) {
            anthropicUncachedStyle = true;
          }
          hasUsage = true;
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
      const totalInputTokens =
        anthropicUncachedStyle && promptTokens < cachedInputTokens + cacheWriteTokens
          ? promptTokens + cachedInputTokens + cacheWriteTokens
          : promptTokens;
      const usage: LlmUsage | undefined = hasUsage
        ? {
            inputTokens: totalInputTokens,
            outputTokens: completionTokens,
            ...(cachedInputTokens > 0 ? { cachedInputTokens } : {}),
            ...(cacheWriteTokens > 0 ? { cacheWriteTokens } : {}),
          }
        : undefined;
      yield { type: "done", finishReason: finishReason || "stop", ...(usage ? { usage } : {}) };
    },
  };
}
