import type { AbortSignalLike, Embedder } from "@cp/core";
import type { Profile } from "../config";
import { AbortedError, toAbortSignal } from "./http";

/** OpenAI 兼容的 /v1/embeddings 轻量客户端；未配置 embeddingModel 或调用失败时降级为空，不阻断回合 */

const DEFAULT_BASE: Record<"openai" | "ollama", string> = {
  openai: "https://api.openai.com/v1",
  ollama: "http://127.0.0.1:11434/v1",
};

interface EmbeddingResponse {
  readonly data?: readonly {
    readonly index?: number;
    readonly embedding?: readonly number[];
  }[];
}

export function embeddingsUrl(profile: Profile): string | null {
  if (profile.type !== "openai" && profile.type !== "ollama") return null;
  const base = (profile.baseUrl ?? DEFAULT_BASE[profile.type]).replace(/\/+$/, "");
  return `${base}/embeddings`;
}

const EMBEDDING_TIMEOUT_MS = 12_000;

export function openAiEmbedder(
  profile: Profile,
  apiKey: string | undefined,
  onWarn?: (message: string) => void,
): Embedder | undefined {
  const model = profile.embeddingModel?.trim();
  const url = embeddingsUrl(profile);
  if (!model || !url) return undefined;
  if (profile.type === "openai" && !apiKey) return undefined;

  return {
    async embed(
      texts: readonly string[],
      signalLike?: AbortSignalLike,
    ): Promise<readonly (readonly number[])[]> {
      if (texts.length === 0) return [];
      const callerSignal = toAbortSignal(signalLike);
      const timeoutSignal = AbortSignal.timeout(EMBEDDING_TIMEOUT_MS);
      const signal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal;
      const headers: Record<string, string> = {
        "content-type": "application/json",
        accept: "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      };
      try {
        const res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({ model, input: [...texts] }),
          signal,
        });
        if (!res.ok) {
          onWarn?.(`向量检索请求失败（HTTP ${res.status}），本轮降级为规则检索`);
          return [];
        }
        const json = (await res.json()) as EmbeddingResponse;
        if (!Array.isArray(json.data) || json.data.length !== texts.length) {
          onWarn?.("向量检索返回维度不匹配，本轮降级为规则检索");
          return [];
        }
        const ordered = [...json.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
        return ordered.map((row) => (Array.isArray(row.embedding) ? row.embedding : []));
      } catch (error) {
        if (callerSignal?.aborted) throw new AbortedError();
        onWarn?.(
          `向量检索不可用，本轮降级为规则检索：${error instanceof Error ? error.message : String(error)}`,
        );
        return [];
      }
    },
  };
}
