import type { AbortSignalLike, LlmClient, LlmEvent, LlmRequest } from "@cp/core";
import type { ConfigService, Profile } from "../config";
import { UpstreamError } from "./http";
import { openAiClient } from "./openai";

export type Resolved =
  | { readonly ok: true; readonly profile: Profile; readonly client: LlmClient }
  | { readonly ok: false; readonly error: string };

/**
 * 按用途（gm / aux）在每次调用时从 config.json 选方案，改了配置不用重启。
 * 选中的方案用不了就直接报错，不悄悄换成别的提供方
 */
export class LlmRouter implements LlmClient {
  constructor(private readonly config: ConfigService) {}

  async resolve(purpose: LlmRequest["purpose"]): Promise<Resolved> {
    const state = await this.config.load();
    if (state.status !== "ok")
      return { ok: false, error: `config.json 还不能用：${state.errors.join("；")}` };
    const name = state.config[purpose];
    const profile = state.config.profiles.find((p) => p.name === name);
    const role = purpose === "gm" ? "主持人" : "辅助模型";
    if (!profile) return { ok: false, error: `${role}指向的方案「${name}」不存在` };
    const key = this.config.keyFor(profile);
    switch (profile.type) {
      case "openai":
        if (!key) {
          const where = profile.apiKeyEnv
            ? `环境变量 ${profile.apiKeyEnv}`
            : "config.json 的 apiKey 或 apiKeyEnv";
          return { ok: false, error: `${role}方案「${profile.name}」没有密钥：请设置${where}` };
        }
        return { ok: true, profile, client: openAiClient(profile, key) };
      case "ollama":
        return { ok: true, profile, client: openAiClient(profile, key) };
      case "gemini":
      case "anthropic":
        return {
          ok: false,
          error: `${role}方案「${profile.name}」是 ${profile.type} 类型，原生接入还没做好；先把 config.json 里的 ${purpose} 指向 OpenAI 兼容的方案（例如 relay）`,
        };
    }
  }

  async *stream(request: LlmRequest, signal?: AbortSignalLike): AsyncGenerator<LlmEvent> {
    const resolved = await this.resolve(request.purpose);
    if (!resolved.ok) throw new UpstreamError(resolved.error);
    yield* resolved.client.stream(request, signal);
  }
}
