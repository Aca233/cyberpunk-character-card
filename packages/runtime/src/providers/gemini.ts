import type { AbortSignalLike, LlmClient, LlmEvent, LlmRequest, LlmUsage } from "@cp/core";
import { z } from "zod";
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

/** Gemini 原生文本流；不自动重试或续写，避免额外调用。 */
const DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta";

const BLOCK_REASONS = new Set([
  "SAFETY",
  "RECITATION",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
  "SPII",
  "IMAGE_SAFETY",
  "IMAGE_PROHIBITED_CONTENT",
  "JAILBREAK",
]);

const SAFETY_CATEGORIES = [
  "HARM_CATEGORY_HARASSMENT",
  "HARM_CATEGORY_HATE_SPEECH",
  "HARM_CATEGORY_SEXUALLY_EXPLICIT",
  "HARM_CATEGORY_DANGEROUS_CONTENT",
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

/** system 单独传入；assistant 转成 model，其余对话保留顺序。 */
export function geminiBody(profile: Profile, request: LlmRequest) {
  const system = request.messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
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
  return {
    contents,
    ...(system !== "" ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    generationConfig: {
      candidateCount: 1,
      ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      // 酒馆预设采样参数：topP 按原生字段传入；topK 需要先确认模型元数据支持，不能无条件发送。
      ...(request.topP !== undefined ? { topP: request.topP } : {}),
      ...(request.responseFormat?.type === "json" ? { responseMimeType: "application/json" } : {}),
      ...(responseSchema ? { responseSchema } : {}),
      ...(profile.thinkingLevel !== undefined
        ? {
            thinkingConfig: {
              thinkingLevel: profile.thinkingLevel,
              includeThoughts:
                request.purpose === "narrator" && request.responseFormat === undefined,
            },
          }
        : {}),
    },
    // 沿用配置含义：off/未设置不传，遵循上游默认；blockNone 显式传阈值。
    // 被拦截时报告 blocked，不重试修改安全设置。
    ...(profile.safety === "blockNone"
      ? {
          safetySettings: SAFETY_CATEGORIES.map((category) => ({
            category,
            threshold: "BLOCK_NONE",
          })),
        }
      : {}),
  };
}

const blockedMessage = "Gemini 拦截了这段内容，请修改输入后重试";

export function geminiClient(profile: Profile, apiKey: string): LlmClient {
  const provider = `方案「${profile.name}」`;
  return {
    async *stream(request: LlmRequest, signalLike?: AbortSignalLike): AsyncGenerator<LlmEvent> {
      const signal = toAbortSignal(signalLike);
      if (signal?.aborted) throw new AbortedError();
      const res = await post(
        provider,
        geminiStreamUrl(profile),
        { "x-goog-api-key": apiKey },
        geminiBody(profile, request),
        signal,
      );
      if (!res.ok) {
        const detail = await errorDetail(res);
        if (signal?.aborted) throw new AbortedError();
        if (detail.code && BLOCK_REASONS.has(detail.code.toUpperCase())) {
          yield { type: "blocked", reason: blockedMessage };
          return;
        }
        throw statusError(provider, res.status, detail.message);
      }
      if (!res.body) throw new UpstreamError(`${provider} 没有返回内容`, res.status, true);
      const contentType = res.headers.get("content-type")?.toLowerCase() ?? "";
      if (!contentType.includes("text/event-stream")) {
        await res.body.cancel().catch(() => {});
        throw new UpstreamError(`${provider} 没有返回流式数据，请检查 baseUrl`, res.status);
      }

      let finishReason = "";
      let visible = false;
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
          if (BLOCK_REASONS.has(chunk.error.status?.toUpperCase() ?? "")) {
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
          (reason && BLOCK_REASONS.has(reason)) ||
          candidate.safetyRatings?.some((r) => r.blocked)
        ) {
          yield { type: "blocked", reason: blockedMessage };
          return;
        }
        // 先放出这一块的正文与思考，再看结束原因：截断时已写出的字留在界面上，但这一轮仍按出错处理
        for (const part of candidate.content?.parts ?? []) {
          if (!part.text) continue;
          if (part.thought === true) {
            yield { type: "thought", text: part.text };
            continue;
          }
          if (part.text.trim() !== "") visible = true;
          yield { type: "text", text: part.text };
        }
        if (reason === "MAX_TOKENS") {
          throw new UpstreamError(
            `${provider} 写到输出上限停了，回复不完整；把最大输出调大，或把思考强度调低`,
          );
        }
        if (reason === "CONTINUATION") {
          throw new UpstreamError(`${provider} 要求续写，这里不自动发起额外的付费请求`);
        }
        if (reason && reason !== "FINISH_REASON_UNSPECIFIED" && reason !== "STOP") {
          throw new UpstreamError(`${provider} 异常结束（${reason}），这次回复不算数`);
        }
        if (reason === "STOP") finishReason = reason;
      }
      if (signal?.aborted) throw new AbortedError();
      if (!finishReason) throw new UpstreamError(`${provider} 的回复没有正常结束`, undefined, true);
      if (!visible) throw new UpstreamError(`${provider} 没有返回正文，检查模型名和最大输出`);
      const cachedInputTokens = tokens?.cachedContentTokenCount ?? 0;
      const usage: LlmUsage | undefined = tokens
        ? {
            inputTokens: tokens.promptTokenCount ?? 0,
            // 思考 token 按输出计费，一起算进输出
            outputTokens: (tokens.candidatesTokenCount ?? 0) + (tokens.thoughtsTokenCount ?? 0),
            ...(cachedInputTokens > 0 ? { cachedInputTokens } : {}),
          }
        : undefined;
      yield { type: "done", finishReason, ...(usage ? { usage } : {}) };
    },
  };
}
