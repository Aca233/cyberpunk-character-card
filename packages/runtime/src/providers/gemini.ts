import type { AbortSignalLike, LlmClient, LlmEvent, LlmRequest, LlmUsage } from "@cp/core";
import { z } from "zod";
import type { Profile } from "../config";
import { EmptyReplyError } from "./empty-reply";
import {
  type GeminiCacheEndpoint,
  geminiCacheEndpoint,
  invalidateGeminiCachedContent,
  resolveGeminiCachedContent,
} from "./gemini-cache";
import { GEMINI_BLOCK_REASONS, isGeminiBlockedError } from "./gemini-errors";
import {
  AbortedError,
  errorDetail,
  post,
  readSse,
  statusError,
  toAbortSignal,
  UpstreamError,
} from "./http";
import { assertNativeSystemPrefix } from "./native-messages";
import { markLlmConnected } from "./stream-watchdog";

/** Gemini 原生文本流；不自动重试或续写，避免额外调用。 */
const DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta";

/** 只有明确指出缓存资源不存在或过期才回退；模型不存在、鉴权、拦截等错误不得重发。 */
function isMissingCachedContent(status: number, message: string): boolean {
  return (
    (status === 400 || status === 404) &&
    /\bcached[\s_-]*contents?\b(?:\s+with\s+(?:name|id)\s+\S+|\s+(?:["'][^"'\r\n]+["']|(?:projects\/|cachedContents\/)[^\s"']+|\d+))?\s+(?:(?:is|was|has|had)\s+)?(?:not\s+found|does\s+not\s+exist|expired)\b|缓存(?:内容|资源)\s*(?:[「“"'][^」”"'\r\n]+[」”"']\s*)?(?:不存在|已过期|过期了)/i.test(
      message,
    )
  );
}

const SAFETY_CATEGORIES = [
  "HARM_CATEGORY_HARASSMENT",
  "HARM_CATEGORY_HATE_SPEECH",
  "HARM_CATEGORY_SEXUALLY_EXPLICIT",
  "HARM_CATEGORY_DANGEROUS_CONTENT",
] as const;

/** Vertex 专属安全类别（图像与越狱类），这些类别用 OFF 阈值关闭（参考 SillyTavern VERTEX_SAFETY） */
const VERTEX_SAFETY_CATEGORIES = [
  "HARM_CATEGORY_IMAGE_HATE",
  "HARM_CATEGORY_IMAGE_DANGEROUS_CONTENT",
  "HARM_CATEGORY_IMAGE_HARASSMENT",
  "HARM_CATEGORY_IMAGE_SEXUALLY_EXPLICIT",
  "HARM_CATEGORY_JAILBREAK",
] as const;

const TokenCount = z.number().int().min(0);
const ChunkSchema = z.object({
  promptFeedback: z
    .object({
      blockReason: z.string().optional(),
    })
    .optional(),
  candidates: z
    .array(
      z.object({
        index: z.number().int().min(0).optional(),
        content: z
          .object({
            parts: z
              .array(
                z.object({
                  text: z.string().optional(),
                  thought: z.boolean().optional(),
                }),
              )
              .optional(),
          })
          .optional(),
        finishReason: z.string().optional(),
        safetyRatings: z
          .array(
            z.object({
              blocked: z.boolean().optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
  usageMetadata: z
    .object({
      promptTokenCount: TokenCount.optional(),
      cachedContentTokenCount: TokenCount.optional(),
      candidatesTokenCount: TokenCount.optional(),
      thoughtsTokenCount: TokenCount.optional(),
    })
    .optional(),
  error: z
    .object({
      code: z.number().int().optional(),
      message: z.string().optional(),
      status: z.string().optional(),
    })
    .optional(),
});

/** baseUrl 填 API 根路径，通常以 /v1beta 结尾；密钥只放请求头。 */
export function geminiStreamUrl(profile: Profile): string {
  const base = new URL(profile.baseUrl ?? DEFAULT_BASE);
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  ) {
    throw new UpstreamError(
      "Gemini 的 baseUrl 必须是 HTTP(S) API 根地址，不能带账号、查询参数或片段",
    );
  }
  const model = profile.model.replace(/^models\//, "");
  if (!model || model === "." || model === ".." || /[/?#\s]/u.test(model)) {
    throw new UpstreamError("Gemini 的 model 要填模型 ID，可带 models/ 前缀，不要填完整网址");
  }
  base.pathname = `${base.pathname.replace(/\/+$/, "")}/models/${encodeURIComponent(model)}:streamGenerateContent`;
  base.searchParams.set("alt", "sse");
  return base.toString();
}

const GEMINI_TYPES: Readonly<Record<string, string>> = {
  object: "OBJECT",
  array: "ARRAY",
  string: "STRING",
  number: "NUMBER",
  integer: "INTEGER",
  boolean: "BOOLEAN",
};

function sanitizeGeminiSchema(
  raw: unknown,
  defs?: Record<string, unknown>,
  depth = 0,
): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== "object" || depth > 12) return undefined;
  const src = raw as Record<string, unknown>;
  const rootDefs =
    defs ??
    (src.$defs as Record<string, unknown> | undefined) ??
    (src.definitions as Record<string, unknown> | undefined);

  if (typeof src.$ref === "string" && rootDefs) {
    const key = src.$ref.replace(/^#\/(?:\$defs|definitions)\//, "");
    const target = rootDefs[key];
    return target ? sanitizeGeminiSchema(target, rootDefs, depth + 1) : undefined;
  }

  const union = Array.isArray(src.anyOf)
    ? src.anyOf
    : Array.isArray(src.oneOf)
      ? src.oneOf
      : undefined;
  if (union) {
    const nonNull = union.filter(
      (v) => !(v && typeof v === "object" && (v as Record<string, unknown>).type === "null"),
    );
    const hasNull = nonNull.length < union.length;
    if (nonNull.length === 1) {
      const inner = sanitizeGeminiSchema(nonNull[0], rootDefs, depth + 1);
      if (!inner) return undefined;
      return {
        ...inner,
        ...(hasNull ? { nullable: true } : {}),
        ...(typeof src.description === "string" && !inner.description
          ? { description: src.description }
          : {}),
      };
    }
    const variants = nonNull
      .map((v) => sanitizeGeminiSchema(v, rootDefs, depth + 1))
      .filter((v): v is Record<string, unknown> => v !== undefined);
    if (variants.length === 0) return undefined;
    return {
      anyOf: variants,
      ...(hasNull ? { nullable: true } : {}),
      ...(typeof src.description === "string" ? { description: src.description } : {}),
    };
  }

  let typeStr: string | undefined;
  let nullable = src.nullable === true;
  if (typeof src.type === "string") {
    typeStr = src.type;
  } else if (Array.isArray(src.type)) {
    const nonNullTypes = src.type.filter((t): t is string => typeof t === "string" && t !== "null");
    nullable = nullable || nonNullTypes.length < src.type.length;
    typeStr = nonNullTypes[0];
  }

  const mappedType = typeStr ? GEMINI_TYPES[typeStr.toLowerCase()] : undefined;
  if (!mappedType) return undefined;

  const out: Record<string, unknown> = { type: mappedType };
  if (nullable) out.nullable = true;
  if (typeof src.description === "string") out.description = src.description;
  if (Array.isArray(src.enum)) {
    out.enum = src.enum.filter((v) => v !== null);
  }

  if (mappedType === "OBJECT") {
    const props = src.properties as Record<string, unknown> | undefined;
    if (!props || typeof props !== "object") return undefined;
    const cleanProps: Record<string, Record<string, unknown>> = {};
    const dropped = new Set<string>();
    for (const [k, v] of Object.entries(props)) {
      const clean = sanitizeGeminiSchema(v, rootDefs, depth + 1);
      if (clean) cleanProps[k] = clean;
      else dropped.add(k);
    }
    if (Object.keys(cleanProps).length === 0) return undefined;
    out.properties = cleanProps;
    if (Array.isArray(src.required)) {
      const req = src.required.filter(
        (k): k is string => typeof k === "string" && !dropped.has(k) && k in cleanProps,
      );
      if (req.length > 0) out.required = req;
    }
  } else if (mappedType === "ARRAY") {
    const itemSchema = sanitizeGeminiSchema(src.items, rootDefs, depth + 1);
    if (!itemSchema) return undefined;
    out.items = itemSchema;
  }

  return out;
}

const SEMI_STATIC_SYSTEM_PREFIX = /^(?:【前情】|【最近几轮)/;

/** 拆分纯静态系统前缀与半静态前缀（【前情】/【最近几轮】），便于显式 cachedContents 只锁纯静态段 */
function splitGeminiSystems(request: LlmRequest): {
  readonly staticSystem: string;
  readonly semiStaticSystem: string;
} {
  assertNativeSystemPrefix(request.messages, "Gemini / Vertex");
  const staticParts: string[] = [];
  const semiParts: string[] = [];
  for (const m of request.messages) {
    if (m.role !== "system" || m.content.trim() === "") continue;
    if (semiParts.length > 0 || SEMI_STATIC_SYSTEM_PREFIX.test(m.content)) {
      semiParts.push(m.content);
    } else {
      staticParts.push(m.content);
    }
  }
  return {
    staticSystem: staticParts.join("\n\n"),
    semiStaticSystem: semiParts.join("\n\n"),
  };
}

/** system 单独传入；assistant 转成 model，其余对话保留顺序。使用显式 cachedContent 时省略已缓存的 systemInstruction。 */
export function geminiBody(profile: Profile, request: LlmRequest, cachedContent?: string) {
  const { staticSystem, semiStaticSystem } = splitGeminiSystems(request);
  const fullSystem = [staticSystem, semiStaticSystem].filter(Boolean).join("\n\n");
  // cachedContent 不允许再传 systemInstruction；半静态 system 必须保持系统角色，不能降为 user。
  const effectiveCachedContent = semiStaticSystem === "" ? cachedContent : undefined;
  const contents = request.messages
    .filter((m) => m.role !== "system")
    .map((m) => {
      const parts: Array<
        | { readonly text: string }
        | { readonly inlineData: { readonly mimeType: string; readonly data: string } }
      > = [];
      if (m.role === "user" && m.images?.length) {
        for (const img of m.images) {
          parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
        }
      }
      if (m.content || parts.length === 0) {
        parts.push({ text: m.content });
      }
      return {
        role: m.role === "assistant" ? "model" : "user",
        parts,
      };
    });
  if (contents.length === 0) throw new UpstreamError("Gemini 请求里没有对话内容");
  const maxOutputTokens = request.maxOutputTokens ?? profile.maxOutputTokens;
  const temperature = request.temperature ?? profile.temperature;
  const responseSchema =
    request.responseFormat?.type === "json" && request.responseFormat.schema
      ? sanitizeGeminiSchema(request.responseFormat.schema)
      : undefined;
  // 保留 Gemini 的内部思考，但不把原生摘要混进预设输出的思考标签。
  // 模型按预设输出的 <think> 等标签仍由 narrator 的 ThoughtStreamSplitter 单独提取。
  const isNarration = request.purpose === "narrator" && request.responseFormat === undefined;
  return {
    contents,
    ...(effectiveCachedContent
      ? { cachedContent: effectiveCachedContent }
      : fullSystem !== ""
        ? { systemInstruction: { parts: [{ text: fullSystem }] } }
        : {}),
    generationConfig: {
      candidateCount: 1,
      ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      // 酒馆预设采样参数：topP 按原生字段传入；topK 需要先确认模型元数据支持，不能无条件发送。
      ...(request.topP !== undefined ? { topP: request.topP } : {}),
      ...(request.responseFormat?.type === "json" ? { responseMimeType: "application/json" } : {}),
      ...(responseSchema ? { responseSchema } : {}),
      ...(profile.thinkingLevel !== undefined || isNarration
        ? {
            thinkingConfig: {
              ...(profile.thinkingLevel !== undefined
                ? { thinkingLevel: profile.thinkingLevel }
                : {}),
              includeThoughts: false,
            },
          }
        : {}),
    },
    // 沿用配置含义：off/未设置不传，遵循上游默认；blockNone 显式传阈值。
    // 被拦截时报告 blocked，不重试修改安全设置。
    ...(profile.safety === "blockNone"
      ? {
          safetySettings: [
            ...SAFETY_CATEGORIES.map((category) => ({
              category,
              threshold: "BLOCK_NONE",
            })),
            ...(profile.type === "vertex"
              ? VERTEX_SAFETY_CATEGORIES.map((category) => ({
                  category,
                  threshold: "OFF",
                }))
              : []),
          ],
        }
      : {}),
  };
}

const blockedMessage = "Gemini 拦截了这段内容，请修改输入后重试";

/** 同协议端点的传输钩子；Vertex 用它换地址构造、请求头认证与显式缓存端点 */
export interface GeminiTransport {
  urlFor?: ((profile: Profile, apiKey: string) => string) | undefined;
  headersFor?:
    | ((
        profile: Profile,
        apiKey: string,
        signal?: AbortSignal,
      ) => Record<string, string> | Promise<Record<string, string>>)
    | undefined;
  cacheEndpointFor?:
    | ((profile: Profile, apiKey: string) => GeminiCacheEndpoint | undefined)
    | undefined;
}

export function geminiClient(
  profile: Profile,
  apiKey: string,
  transport?: GeminiTransport,
): LlmClient {
  const urlFor = transport?.urlFor ?? ((p: Profile) => geminiStreamUrl(p));
  const headersFor =
    transport?.headersFor ?? ((_p: Profile, key: string) => ({ "x-goog-api-key": key }));
  const cacheEndpointFor =
    transport?.cacheEndpointFor ?? ((p: Profile) => geminiCacheEndpoint(p, DEFAULT_BASE));
  const provider = `方案「${profile.name}」`;
  return {
    async *stream(request: LlmRequest, signalLike?: AbortSignalLike): AsyncGenerator<LlmEvent> {
      const signal = toAbortSignal(signalLike);
      if (signal?.aborted) throw new AbortedError();
      // 在鉴权换 token、缓存创建等准备请求之前验证消息序列。
      const { staticSystem, semiStaticSystem } = splitGeminiSystems(request);
      const headers = await headersFor(profile, apiKey, signal ?? undefined);
      // 半静态段随历史增长；保留完整 systemInstruction，使用上游隐式缓存，避免反复创建远端缓存。
      const cachedContent =
        semiStaticSystem === ""
          ? await resolveGeminiCachedContent(
              profile,
              cacheEndpointFor(profile, apiKey),
              headers,
              staticSystem,
              signal ?? undefined,
            )
          : undefined;
      let res = await post(
        provider,
        urlFor(profile, apiKey),
        headers,
        geminiBody(profile, request, cachedContent),
        signal,
      );
      markLlmConnected(signal);
      if (!res.ok) {
        let detail = await errorDetail(res);
        if (signal?.aborted) throw new AbortedError();
        // 安全错误优先于缓存失效；即使文案提及 cachedContent 也不能重发。
        if (isGeminiBlockedError(detail)) {
          yield { type: "blocked", reason: blockedMessage };
          return;
        }
        if (cachedContent && isMissingCachedContent(res.status, detail.message)) {
          invalidateGeminiCachedContent(cachedContent);
          res = await post(
            provider,
            urlFor(profile, apiKey),
            headers,
            geminiBody(profile, request),
            signal,
          );
          if (!res.ok) {
            detail = await errorDetail(res);
            if (signal?.aborted) throw new AbortedError();
          }
        }
        if (!res.ok) {
          if (isGeminiBlockedError(detail)) {
            yield { type: "blocked", reason: blockedMessage };
            return;
          }
          throw statusError(provider, res.status, detail.message);
        }
      }
      if (!res.body) throw new UpstreamError(`${provider} 没有返回内容`, res.status, true);
      const contentType = res.headers.get("content-type")?.toLowerCase() ?? "";
      if (!contentType.includes("text/event-stream")) {
        await res.body.cancel().catch(() => {});
        throw new UpstreamError(`${provider} 没有返回流式数据，请检查 baseUrl`, res.status);
      }

      let finishReason = "";
      let visible = false;
      let hasThought = false;
      let tokens: z.infer<typeof ChunkSchema>["usageMetadata"];
      for await (const event of readSse(provider, res.body, signal)) {
        if (event.data === "[DONE]") break;
        let raw: unknown;
        try {
          raw = JSON.parse(event.data);
        } catch {
          throw new UpstreamError(`${provider} 返回了看不懂的数据`, undefined, true);
        }
        const parsed = ChunkSchema.safeParse(raw);
        if (!parsed.success) {
          throw new UpstreamError(`${provider} 返回的数据格式不对`, undefined, true);
        }
        const chunk = parsed.data;
        if (chunk.error) {
          if (isGeminiBlockedError(chunk.error)) {
            yield { type: "blocked", reason: blockedMessage };
            return;
          }
          const code = chunk.error.code;
          if (code !== undefined && code >= 400 && code <= 599) {
            throw statusError(provider, code, chunk.error.message ?? "");
          }
          throw new UpstreamError(
            `${provider} 生成到一半出错：${chunk.error.message ?? chunk.error.status ?? "未知错误"}`,
            undefined,
            true,
          );
        }
        const blocked = chunk.promptFeedback?.blockReason;
        if (blocked && blocked !== "BLOCK_REASON_UNSPECIFIED") {
          yield { type: "blocked", reason: blockedMessage };
          return;
        }
        // 用量是到目前为止的累计值：后面的块覆盖前面的，不相加
        if (chunk.usageMetadata) tokens = { ...tokens, ...chunk.usageMetadata };
        const candidate = chunk.candidates?.find((c) => (c.index ?? 0) === 0);
        if (!candidate) continue;
        const reason = candidate.finishReason;
        if (
          (reason && GEMINI_BLOCK_REASONS.has(reason)) ||
          candidate.safetyRatings?.some((r) => r.blocked)
        ) {
          yield { type: "blocked", reason: blockedMessage };
          return;
        }
        // 先放出这一块的正文与思考，再看结束原因：截断时已写出的字留在界面上，但这一轮仍按出错处理
        for (const part of candidate.content?.parts ?? []) {
          if (!part.text) continue;
          if (part.thought === true) {
            if (part.text.trim() !== "") hasThought = true;
            yield { type: "thought", text: part.text };
            continue;
          }
          if (part.text.trim() !== "") visible = true;
          yield { type: "text", text: part.text };
        }
        if (reason === "MAX_TOKENS") {
          finishReason = "max_tokens";
        }
        if (reason === "CONTINUATION") {
          finishReason = "continuation";
        }
        if (
          reason &&
          reason !== "FINISH_REASON_UNSPECIFIED" &&
          reason !== "STOP" &&
          reason !== "MAX_TOKENS" &&
          reason !== "CONTINUATION"
        ) {
          throw new UpstreamError(`${provider} 异常结束（${reason}），这次回复不算数`);
        }
        if (reason === "STOP") finishReason = reason;
      }
      if (signal?.aborted) throw new AbortedError();
      const cachedInputTokens = tokens?.cachedContentTokenCount ?? 0;
      const usage: LlmUsage | undefined = tokens
        ? {
            inputTokens: tokens.promptTokenCount ?? 0,
            // 思考 token 按输出计费，一起算进输出
            outputTokens: (tokens.candidatesTokenCount ?? 0) + (tokens.thoughtsTokenCount ?? 0),
            ...(cachedInputTokens > 0 ? { cachedInputTokens } : {}),
          }
        : undefined;
      if (!visible) {
        throw new EmptyReplyError(provider, {
          finishReason,
          maxOutputTokens: request.maxOutputTokens ?? profile.maxOutputTokens,
          usage,
          hasThought,
          thinkingTokens: tokens?.thoughtsTokenCount,
        });
      }
      yield {
        type: "done",
        finishReason: finishReason || "incomplete",
        ...(usage ? { usage } : {}),
      };
    },
  };
}
