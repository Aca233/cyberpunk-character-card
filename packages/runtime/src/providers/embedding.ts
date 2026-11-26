import type { AbortSignalLike, Embedder, EmbedOptions, EmbedTask } from "@cp/core";
import type { Profile, ProviderType } from "../config";
import { AbortedError, errorDetail, statusError, toAbortSignal, UpstreamError } from "./http";
import { relayFetch } from "./relay";

/**
 * 多提供方向量嵌入客户端：
 * - OpenAI 兼容 / Ollama：POST {base}/embeddings（自动分批，遇单批条数限制时自适应降批）
 * - Gemini 原生：POST {base}/models/{model}:batchEmbedContents（支持 RETRIEVAL_QUERY / RETRIEVAL_DOCUMENT）
 * 常规回合调用失败或超时时降级为空数组并回调警告，不阻断回合；
 * 连接测试（probeEmbedding）会直接抛出明确错误并返回向量维度。
 */

const DEFAULT_BASE: Readonly<Record<"openai" | "ollama" | "gemini", string>> = {
  openai: "https://api.openai.com/v1",
  ollama: "http://127.0.0.1:11434/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
};

const EMBEDDING_TIMEOUT_MS = 15_000;
/** 默认每批 16 条：兼顾主流中转站与部分模型 16/20/25 条的单批上限，减少首轮 400 重拆 */
const EMBEDDING_BATCH_SIZE = 16;

/** 识别上游 HTTP 400 明确提示“单批输入条数超限”的报错文案 */
const BATCH_LIMIT_HINT_RE =
  /最多|上限|分批|batch|too many|exceed|max(?:imum)?\s*(?:batch|inputs?|items?|texts?|requests?)|input[s]?\s*(?:size|count|length|limit)|array\s*(?:length|size)/i;

const BATCH_LIMIT_NUMBER_PATTERNS: readonly RegExp[] = [
  /最多\s*(?:支持|允许|包含|处理)?\s*(\d+)\s*(?:条|个|项)?/,
  /不超过\s*(\d+)\s*(?:条|个|项)?/,
  /(?:max(?:imum)?\s*(?:batch\s*size|inputs?|items?|texts?|requests?)?|up\s+to|at\s+most|limit\s*(?:is|of|:)?)\s*(\d+)/i,
];

function extractBatchLimit(message: string, currentSize: number): number | undefined {
  if (currentSize <= 1 || !BATCH_LIMIT_HINT_RE.test(message)) return undefined;
  for (const pattern of BATCH_LIMIT_NUMBER_PATTERNS) {
    const match = pattern.exec(message);
    const parsed = match?.[1] ? Number(match[1]) : Number.NaN;
    if (Number.isInteger(parsed) && parsed >= 1 && parsed < currentSize) {
      return parsed;
    }
  }
  return Math.max(1, Math.floor(currentSize / 2));
}

export type EmbeddingProviderType = "openai" | "ollama" | "gemini";

export function isEmbeddingProviderType(type: ProviderType): type is EmbeddingProviderType {
  return type === "openai" || type === "ollama" || type === "gemini";
}

/** 独立向量方案优先用 embeddingModel，未填时直接用该连接的 model；附挂对话方案仅用 embeddingModel */
export function embeddingModelFor(
  profile: Profile,
  mode: "dedicated" | "attached",
): string | undefined {
  const explicit = profile.embeddingModel?.trim();
  if (explicit) return explicit;
  if (mode === "dedicated") return profile.model.trim() || undefined;
  return undefined;
}

function normalizedBase(profile: Profile): string | null {
  if (!isEmbeddingProviderType(profile.type)) return null;
  return (profile.baseUrl ?? DEFAULT_BASE[profile.type]).replace(/\/+$/, "");
}

/** 向量缓存隔离键：切换提供方、接口地址或向量模型时自动失效旧维度缓存 */
export function embeddingModelKey(profile: Profile, model: string): string {
  const base = normalizedBase(profile) ?? "";
  const cleanModel = profile.type === "gemini" ? model.replace(/^models\//, "") : model;
  return `${profile.type}|${base}|${cleanModel}`;
}

export function embeddingsUrl(profile: Profile, model?: string): string | null {
  if (!isEmbeddingProviderType(profile.type)) return null;
  const base = normalizedBase(profile);
  if (!base) return null;
  if (profile.type === "gemini") {
    const cleanModel = (model ?? profile.embeddingModel ?? profile.model)
      .trim()
      .replace(/^models\//, "");
    if (!cleanModel || cleanModel === "." || cleanModel === ".." || /[/?#\s]/u.test(cleanModel)) {
      return null;
    }
    const parsed = new URL(base);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    parsed.pathname = `${parsed.pathname.replace(/\/+$/, "")}/models/${encodeURIComponent(cleanModel)}:batchEmbedContents`;
    return parsed.toString();
  }
  return `${base}/embeddings`;
}

interface OpenAiEmbeddingResponse {
  readonly data?: readonly {
    readonly index?: number;
    readonly embedding?: readonly number[];
  }[];
}

interface GeminiBatchEmbedResponse {
  readonly embeddings?: readonly {
    readonly values?: readonly number[];
  }[];
}

function normalizeOptions(signalOrOptions?: AbortSignalLike | EmbedOptions): {
  readonly signal?: AbortSignalLike | undefined;
  readonly task?: EmbedTask | undefined;
} {
  if (!signalOrOptions) return {};
  if ("aborted" in signalOrOptions && "addEventListener" in signalOrOptions) {
    return { signal: signalOrOptions };
  }
  return signalOrOptions;
}

async function embedOpenAiBatch(
  url: string,
  model: string,
  apiKey: string | undefined,
  texts: readonly string[],
  signal: AbortSignal,
): Promise<readonly (readonly number[])[]> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
  };
  const res = await relayFetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ model, input: [...texts] }),
    signal,
  });
  if (!res.ok) {
    const detail = (await errorDetail(res)).message;
    throw statusError("向量接口", res.status, detail);
  }
  const json = (await res.json()) as OpenAiEmbeddingResponse;
  if (!Array.isArray(json.data) || json.data.length !== texts.length) {
    throw new UpstreamError("向量接口返回条目数与输入不匹配");
  }
  const ordered = [...json.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const out = ordered.map((row) => (Array.isArray(row.embedding) ? row.embedding : []));
  if (out.some((vec) => vec.length === 0)) {
    throw new UpstreamError("向量接口返回了空向量");
  }
  return out;
}

async function embedGeminiBatch(
  url: string,
  model: string,
  apiKey: string,
  texts: readonly string[],
  task: EmbedTask | undefined,
  signal: AbortSignal,
): Promise<readonly (readonly number[])[]> {
  const cleanModel = model.replace(/^models\//, "");
  const taskType =
    task === "query" ? "RETRIEVAL_QUERY" : task === "document" ? "RETRIEVAL_DOCUMENT" : undefined;
  const res = await relayFetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      requests: texts.map((text) => ({
        model: `models/${cleanModel}`,
        content: { parts: [{ text }] },
        ...(taskType ? { taskType } : {}),
      })),
    }),
    signal,
  });
  if (!res.ok) {
    const detail = (await errorDetail(res)).message;
    throw statusError("Gemini 向量接口", res.status, detail);
  }
  const json = (await res.json()) as GeminiBatchEmbedResponse;
  if (!Array.isArray(json.embeddings) || json.embeddings.length !== texts.length) {
    throw new UpstreamError("Gemini 向量接口返回条目数与输入不匹配");
  }
  const out = json.embeddings.map((row) => (Array.isArray(row.values) ? row.values : []));
  if (out.some((vec) => vec.length === 0)) {
    throw new UpstreamError("Gemini 向量接口返回了空向量");
  }
  return out;
}

async function embedStrict(
  profile: Profile,
  apiKey: string | undefined,
  model: string,
  texts: readonly string[],
  options: { readonly signal?: AbortSignalLike | undefined; readonly task?: EmbedTask | undefined },
): Promise<readonly (readonly number[])[]> {
  if (texts.length === 0) return [];
  if (!isEmbeddingProviderType(profile.type)) {
    throw new UpstreamError(`提供方 ${profile.type} 暂不支持向量嵌入`);
  }
  const url = embeddingsUrl(profile, model);
  if (!url) {
    throw new UpstreamError("向量接口地址或模型名称无效");
  }
  if ((profile.type === "openai" || profile.type === "gemini") && !apiKey) {
    throw new UpstreamError(`向量方案「${profile.name}」缺少 API 密钥`);
  }

  const callerSignal = toAbortSignal(options.signal);
  const results: (readonly number[])[] = [];
  let batchSize = EMBEDDING_BATCH_SIZE;
  let start = 0;

  while (start < texts.length) {
    if (callerSignal?.aborted) throw new AbortedError();
    const chunk = texts.slice(start, start + batchSize);
    const timeoutSignal = AbortSignal.timeout(EMBEDDING_TIMEOUT_MS);
    const signal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal;
    try {
      const vectors =
        profile.type === "gemini"
          ? await embedGeminiBatch(url, model, apiKey as string, chunk, options.task, signal)
          : await embedOpenAiBatch(url, model, apiKey, chunk, signal);
      results.push(...vectors);
      start += chunk.length;
    } catch (error) {
      if (callerSignal?.aborted) throw new AbortedError();
      if (error instanceof UpstreamError) {
        if (error.status === 400 && chunk.length > 1) {
          const nextLimit = extractBatchLimit(error.message, chunk.length);
          if (nextLimit !== undefined && nextLimit < chunk.length) {
            batchSize = nextLimit;
            continue;
          }
        }
        throw error;
      }
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new UpstreamError("向量嵌入请求超时");
      }
      throw new UpstreamError(error instanceof Error ? error.message : String(error));
    }
  }
  return results;
}

/** 构造可供回合检索使用的容错向量客户端；单次请求失败时返回空数组并降级规则检索 */
export function createEmbedder(
  profile: Profile,
  apiKey: string | undefined,
  model: string,
  onWarn?: (message: string) => void,
): Embedder | undefined {
  const cleanModel = model.trim();
  if (!cleanModel || !isEmbeddingProviderType(profile.type)) return undefined;
  if (!embeddingsUrl(profile, cleanModel)) return undefined;
  if ((profile.type === "openai" || profile.type === "gemini") && !apiKey) return undefined;

  return {
    async embed(
      texts: readonly string[],
      signalOrOptions?: AbortSignalLike | EmbedOptions,
    ): Promise<readonly (readonly number[])[]> {
      if (texts.length === 0) return [];
      const opts = normalizeOptions(signalOrOptions);
      try {
        return await embedStrict(profile, apiKey, cleanModel, texts, opts);
      } catch (error) {
        if (error instanceof AbortedError || opts.signal?.aborted) throw new AbortedError();
        onWarn?.(
          `向量检索不可用，本轮降级为规则检索：${error instanceof Error ? error.message : String(error)}`,
        );
        return [];
      }
    },
  };
}

/** 连接测试专用：直接发一条极短文本，返回向量维度或抛出明确错误 */
export async function probeEmbedding(
  profile: Profile,
  apiKey: string | undefined,
  model: string,
  signal?: AbortSignalLike,
): Promise<{ readonly dimensions: number; readonly model: string }> {
  const cleanModel = model.trim();
  const vectors = await embedStrict(profile, apiKey, cleanModel, ["夜之城连接测试"], {
    signal,
    task: "query",
  });
  const first = vectors[0];
  if (!first || first.length === 0) {
    throw new UpstreamError("向量接口未返回有效维度");
  }
  return { dimensions: first.length, model: cleanModel };
}
