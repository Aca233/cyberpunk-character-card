import type { AbortSignalLike, Reranker, RerankOptions, RerankResult } from "@cp/core";
import type { Profile, ProviderType } from "../config";
import { AbortedError, errorDetail, statusError, toAbortSignal, UpstreamError } from "./http";
import { relayFetch } from "./relay";

/**
 * 语义重排（Reranker）客户端：
 * 兼容硅基流动（SiliconFlow）、Jina、Cohere、vLLM / Xinference 等主流 POST {base}/rerank 协议
 * （如 Qwen/Qwen3-Reranker-8B、BAAI/bge-reranker-v2-m3）。
 * 常规回合调用失败或超时时降级为空数组并回调警告，不阻断回合；
 * 连接测试（probeReranker）会直接返回最高相关度或抛出明确错误。
 */

const DEFAULT_BASE: Readonly<Record<"openai" | "ollama", string>> = {
  openai: "https://api.openai.com/v1",
  ollama: "http://127.0.0.1:11434/v1",
};

const RERANK_TURN_TIMEOUT_MS = 6_000;
const RERANK_PROBE_TIMEOUT_MS = 15_000;
const RERANK_COOLDOWN_MS = 60_000;

const rerankCooldownUntil = new Map<string, number>();

export type RerankProviderType = "openai" | "ollama";

export function isRerankProviderType(type: ProviderType): type is RerankProviderType {
  return type === "openai" || type === "ollama";
}

export function rerankUrl(profile: Profile): string | null {
  if (!isRerankProviderType(profile.type)) return null;
  const base = (profile.baseUrl ?? DEFAULT_BASE[profile.type]).replace(/\/+$/, "");
  if (!base) return null;
  return base.endsWith("/rerank") ? base : `${base}/rerank`;
}

interface RerankRow {
  readonly index?: number;
  readonly relevance_score?: number;
  readonly score?: number;
}

interface RerankResponse {
  readonly results?: readonly RerankRow[];
  readonly data?: readonly RerankRow[];
}

async function rerankStrict(
  profile: Profile,
  apiKey: string | undefined,
  model: string,
  query: string,
  documents: readonly string[],
  options?: RerankOptions & { readonly timeoutMs?: number | undefined },
): Promise<readonly RerankResult[]> {
  if (documents.length === 0 || query.trim() === "") return [];
  if (!isRerankProviderType(profile.type)) {
    throw new UpstreamError(`提供方 ${profile.type} 暂不支持 /rerank 重排接口`);
  }
  const url = rerankUrl(profile);
  if (!url) throw new UpstreamError("重排接口地址无效");
  if (profile.type === "openai" && !apiKey) {
    throw new UpstreamError(`重排方案「${profile.name}」缺少 API 密钥`);
  }

  const callerSignal = toAbortSignal(options?.signal);
  const timeoutSignal = AbortSignal.timeout(options?.timeoutMs ?? RERANK_TURN_TIMEOUT_MS);
  const signal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal;
  const topN =
    options?.topN !== undefined
      ? Math.max(1, Math.min(documents.length, Math.floor(options.topN)))
      : documents.length;

  try {
    const res = await relayFetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        query,
        documents: [...documents],
        top_n: topN,
        return_documents: false,
      }),
      signal,
    });
    if (!res.ok) {
      const detail = (await errorDetail(res)).message;
      throw statusError("重排接口", res.status, detail);
    }
    const json = (await res.json()) as RerankResponse;
    const rows = Array.isArray(json.results)
      ? json.results
      : Array.isArray(json.data)
        ? json.data
        : null;
    if (!rows) throw new UpstreamError("重排接口返回格式无法识别（缺少 results 数组）");
    const out: RerankResult[] = [];
    for (const row of rows) {
      const idx = row.index;
      const rawScore =
        typeof row.relevance_score === "number"
          ? row.relevance_score
          : typeof row.score === "number"
            ? row.score
            : undefined;
      if (
        typeof idx !== "number" ||
        !Number.isInteger(idx) ||
        idx < 0 ||
        idx >= documents.length ||
        rawScore === undefined ||
        !Number.isFinite(rawScore)
      ) {
        continue;
      }
      out.push({ index: idx, score: rawScore });
    }
    if (out.length === 0) throw new UpstreamError("重排接口未返回有效的相关度结果");
    return out;
  } catch (error) {
    if (callerSignal?.aborted) throw new AbortedError();
    if (error instanceof UpstreamError) throw error;
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new UpstreamError("重排请求超时");
    }
    throw new UpstreamError(error instanceof Error ? error.message : String(error));
  }
}

/** 构造回合检索使用的容错重排客户端；失败时降级为空数组并记录警告，不阻断回合 */
export function createReranker(
  profile: Profile,
  apiKey: string | undefined,
  model: string,
  onWarn?: (message: string) => void,
): Reranker | undefined {
  const cleanModel = model.trim();
  const url = rerankUrl(profile);
  if (!cleanModel || !isRerankProviderType(profile.type)) return undefined;
  if (!url) return undefined;
  if (profile.type === "openai" && !apiKey) return undefined;
  const cooldownKey = `${url}|${cleanModel}`;

  return {
    async rerank(
      query: string,
      documents: readonly string[],
      options?: RerankOptions,
    ): Promise<readonly RerankResult[]> {
      if (documents.length === 0 || query.trim() === "") return [];
      const blockedUntil = rerankCooldownUntil.get(cooldownKey);
      if (blockedUntil !== undefined && blockedUntil > Date.now()) {
        return [];
      }
      try {
        const res = await rerankStrict(profile, apiKey, cleanModel, query, documents, {
          ...options,
          timeoutMs: RERANK_TURN_TIMEOUT_MS,
        });
        rerankCooldownUntil.delete(cooldownKey);
        return res;
      } catch (error) {
        if (error instanceof AbortedError || options?.signal?.aborted) throw new AbortedError();
        rerankCooldownUntil.set(cooldownKey, Date.now() + RERANK_COOLDOWN_MS);
        onWarn?.(
          `语义重排不可用，本轮回退一阶段检索（冷却 60s）：${error instanceof Error ? error.message : String(error)}`,
        );
        return [];
      }
    },
  };
}

/** 连接测试专用：发送两条对比文本，验证 /rerank 连通并返回最高相关度 */
export async function probeReranker(
  profile: Profile,
  apiKey: string | undefined,
  model: string,
  signal?: AbortSignalLike,
): Promise<{ readonly topScore: number; readonly count: number; readonly model: string }> {
  const cleanModel = model.trim();
  const url = rerankUrl(profile);
  if (url) rerankCooldownUntil.delete(`${url}|${cleanModel}`);
  const ranked = await rerankStrict(
    profile,
    apiKey,
    cleanModel,
    "维克多诊所的义眼调试",
    [
      "义体医生维克多在诊所地下室给玩家校准岐路司义眼。",
      "今晚海伍德街头下起了酸雨，霓虹招牌忽明忽暗。",
    ],
    { topN: 2, signal, timeoutMs: RERANK_PROBE_TIMEOUT_MS },
  );
  const topScore = ranked.reduce((best, r) => Math.max(best, r.score), 0);
  return { topScore, count: ranked.length, model: cleanModel };
}
