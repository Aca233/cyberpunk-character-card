import type { AbortSignalLike, Embedder, LlmClient, LlmEvent, LlmRequest } from "@cp/core";
import type { ConfigService, Profile } from "../config";
import { anthropicClient } from "./anthropic";
import { openAiEmbedder } from "./embedding";
import { geminiClient } from "./gemini";
import { UpstreamError } from "./http";
import { openAiClient } from "./openai";

export type Resolved =
  | { readonly ok: true; readonly profile: Profile; readonly client: LlmClient }
  | { readonly ok: false; readonly error: string };

/**
 * 按用途（narrator / aux）在每次调用时从 config.json 选方案，改了配置不用重启。
 * 选中的方案用不了就直接报错，不悄悄换成别的提供方。
 * pick 可以按用途指定方案名，覆盖 config.json 里的选择（测评工具用）
 */
export class LlmRouter implements LlmClient {
  constructor(
    private readonly config: ConfigService,
    private readonly pick: Partial<Record<LlmRequest["purpose"], string>> = {},
  ) {}

  async resolve(purpose: LlmRequest["purpose"]): Promise<Resolved> {
    const state = await this.config.load();
    if (state.status !== "ok")
      return { ok: false, error: `模型配置还不能用：${state.errors.join("；")}` };
    const name = this.pick[purpose] ?? state.config[purpose];
    const profile = state.config.profiles.find((p) => p.name === name);
    const role = purpose === "narrator" ? "叙事模型" : "辅助模型";
    if (name === undefined)
      return {
        ok: false,
        error: `还没有选${role}：到设置页添加一个模型连接，再点「设为${role}」`,
      };
    if (!profile) return { ok: false, error: `${role}指向的方案「${name}」不存在` };
    const key = this.config.keyFor(profile);
    switch (profile.type) {
      case "openai":
        if (!key) {
          return {
            ok: false,
            error: `${role}方案「${profile.name}」没有密钥：到设置页的「模型方案」里粘贴密钥并保存`,
          };
        }
        return { ok: true, profile, client: openAiClient(profile, key) };
      case "ollama":
        return { ok: true, profile, client: openAiClient(profile, key) };
      case "gemini":
        if (!key) {
          return {
            ok: false,
            error: `${role}方案「${profile.name}」没有密钥：到设置页的「模型方案」里粘贴密钥并保存`,
          };
        }
        return { ok: true, profile, client: geminiClient(profile, key) };
      case "anthropic":
        if (!key) {
          return {
            ok: false,
            error: `${role}方案「${profile.name}」没有密钥：到设置页的「模型方案」里粘贴密钥并保存`,
          };
        }
        return { ok: true, profile, client: anthropicClient(profile, key) };
      case "sdwebui":
      case "comfyui":
      case "novelai":
        return {
          ok: false,
          error: `${role}方案「${profile.name}」是 ${profile.type} 文生图服务，只能用于「文生图模型」，不能当${role}`,
        };
    }
  }

  /** 为旧记忆语义检索解析可选的 embedding 客户端（优先 aux 方案，其次 narrator 方案） */
  async resolveEmbedder(onWarn?: (message: string) => void): Promise<Embedder | undefined> {
    const state = await this.config.load();
    if (state.status !== "ok") return undefined;
    const names = [this.pick.aux ?? state.config.aux, this.pick.narrator ?? state.config.narrator];
    for (const name of names) {
      if (!name) continue;
      const profile = state.config.profiles.find((p) => p.name === name);
      if (!profile?.embeddingModel) continue;
      const embedder = openAiEmbedder(profile, this.config.keyFor(profile), onWarn);
      if (embedder) return embedder;
    }
    return undefined;
  }

  async *stream(request: LlmRequest, signal?: AbortSignalLike): AsyncGenerator<LlmEvent> {
    const resolved = await this.resolve(request.purpose);
    if (!resolved.ok) throw new UpstreamError(resolved.error);
    yield* resolved.client.stream(request, signal);
  }
}
