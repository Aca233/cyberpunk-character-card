import type { AbortSignalLike, LlmClient, LlmEvent, LlmRequest, LlmUsage } from "@cp/core";
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

interface ChatChunk {
  readonly choices?: readonly {
    readonly delta?: { readonly content?: string | null };
    readonly finish_reason?: string | null;
  }[];
  readonly usage?: { readonly prompt_tokens?: number; readonly completion_tokens?: number } | null;
  readonly error?: {
    readonly message?: string;
    readonly code?: string | null;
    readonly type?: string;
  };
}

export function chatCompletionsUrl(profile: Profile): string {
  const base = profile.baseUrl ?? DEFAULT_BASE[profile.type === "ollama" ? "ollama" : "openai"];
  return `${base.replace(/\/+$/, "")}/chat/completions`;
}

export function openAiClient(profile: Profile, apiKey: string | undefined): LlmClient {
  const provider = `方案「${profile.name}」`;
  return {
    async *stream(request: LlmRequest, signalLike?: AbortSignalLike): AsyncGenerator<LlmEvent> {
      const signal = toAbortSignal(signalLike);
      if (signal?.aborted) throw new AbortedError();
      const maxTokens = request.maxOutputTokens ?? profile.maxOutputTokens;
      const temperature = request.temperature ?? profile.temperature;
      const body = {
        model: profile.model,
        messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
        stream_options: { include_usage: true },
        ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
        ...(temperature !== undefined ? { temperature } : {}),
      };
      const headers: Record<string, string> = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
      const res = await post(provider, chatCompletionsUrl(profile), headers, body, signal);
      if (!res.ok) {
        const detail = await errorDetail(res);
        if (detail.code && BLOCK_CODES.has(detail.code)) {
          yield { type: "blocked", reason: detail.message || "上游拦截了这段内容" };
          return;
        }
        throw statusError(provider, res.status, detail.message);
      }
      if (!res.body) throw new UpstreamError(`${provider} 没有返回内容`, res.status, true);

      let finishReason = "";
      let usage: LlmUsage | undefined;
      let finished = false;
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
          if (BLOCK_CODES.has(code)) {
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
          const text = choice.delta?.content;
          if (text) yield { type: "text", text };
          if (choice.finish_reason) finishReason = choice.finish_reason;
        }
        if (chunk.usage) {
          usage = {
            inputTokens: chunk.usage.prompt_tokens ?? 0,
            outputTokens: chunk.usage.completion_tokens ?? 0,
          };
        }
      }
      if (finishReason === "content_filter") {
        yield { type: "blocked", reason: "上游在生成途中拦截了这段内容" };
        return;
      }
      if (!finished && !finishReason)
        throw new UpstreamError(`${provider} 的回复没有正常结束`, undefined, true);
      yield { type: "done", finishReason: finishReason || "stop", ...(usage ? { usage } : {}) };
    },
  };
}
