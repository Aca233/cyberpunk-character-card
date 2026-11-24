import type {
  AbortSignalLike,
  Embedder,
  LlmClient,
  LlmEvent,
  LlmRequest,
  Reranker,
} from "@cp/core";
import type { ConfigService, Profile } from "../config";
import type { EmbeddingCacheStore } from "../embedding-cache";
import { anthropicClient } from "./anthropic";
import {
  createEmbedder,
  embeddingModelFor,
  embeddingModelKey,
  embeddingsUrl,
  isEmbeddingProviderType,
} from "./embedding";
import { geminiClient } from "./gemini";
import { UpstreamError } from "./http";
import { openAiClient } from "./openai";
import { createReranker, isRerankProviderType, rerankUrl } from "./rerank";

export type Resolved =
  | { readonly ok: true; readonly profile: Profile; readonly client: LlmClient }
  | { readonly ok: false; readonly error: string };

export type ResolvedEmbeddingTarget =
  | {
      readonly configured: false;
      readonly ok: false;
      readonly error: null;
    }
  | {
      readonly configured: true;
      readonly ok: true;
      readonly profile: Profile;
      readonly model: string;
      readonly modelKey: string;
      readonly source: "embedding" | "aux" | "narrator";
    }
  | {
      readonly configured: true;
      readonly ok: false;
      readonly error: string;
      readonly source: "embedding" | "aux" | "narrator";
    };

export type ResolvedRerankerTarget =
  | {
      readonly configured: false;
      readonly ok: false;
      readonly error: null;
    }
  | {
      readonly configured: true;
      readonly ok: true;
      readonly profile: Profile;
      readonly model: string;
    }
  | {
      readonly configured: true;
      readonly ok: false;
      readonly error: string;
    };

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
    const rawProfile = state.config.profiles.find((p) => p.name === name);
    const role = purpose === "narrator" ? "叙事模型" : "辅助模型";
    if (name === undefined)
      return {
        ok: false,
        error: `还没有选${role}：到设置页添加一个模型连接，再点「设为${role}」`,
      };
    if (!rawProfile) return { ok: false, error: `${role}指向的方案「${name}」不存在` };
    const modelOverride = !this.pick[purpose]
      ? state.config.roleModels?.[purpose]?.trim()
      : undefined;
    const profile: Profile = modelOverride ? { ...rawProfile, model: modelOverride } : rawProfile;
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

  /**
   * 解析当前生效的向量模型方案：
   * 1. 优先独立「向量模型（config.embedding）」方案（使用其 embeddingModel 或 model）
   * 2. 未配置独立方案时，回退检查 aux / narrator 方案里可选填写的 embeddingModel
   */
  async resolveEmbeddingTarget(): Promise<ResolvedEmbeddingTarget> {
    const state = await this.config.load();
    if (state.status !== "ok") return { configured: false, ok: false, error: null };

    const validate = (
      profile: Profile,
      model: string,
      source: "embedding" | "aux" | "narrator",
    ): ResolvedEmbeddingTarget => {
      if (!isEmbeddingProviderType(profile.type)) {
        return {
          configured: true,
          ok: false,
          source,
          error: `向量方案「${profile.name}」（${profile.type}）不支持向量嵌入，请改用 OpenAI 兼容、Ollama 或 Gemini 连接`,
        };
      }
      const key = this.config.keyFor(profile);
      if ((profile.type === "openai" || profile.type === "gemini") && !key) {
        return {
          configured: true,
          ok: false,
          source,
          error: `向量方案「${profile.name}」还没有填写 API 密钥`,
        };
      }
      if (!embeddingsUrl(profile, model)) {
        return {
          configured: true,
          ok: false,
          source,
          error: `向量方案「${profile.name}」的接口地址或模型名不合法`,
        };
      }
      return {
        configured: true,
        ok: true,
        profile,
        model,
        modelKey: embeddingModelKey(profile, model),
        source,
      };
    };

    if (state.config.embedding) {
      const profile = state.config.profiles.find((p) => p.name === state.config.embedding);
      if (!profile) {
        return {
          configured: true,
          ok: false,
          source: "embedding",
          error: `向量模型指向的方案「${state.config.embedding}」不存在`,
        };
      }
      const model =
        state.config.roleModels?.embedding?.trim() || embeddingModelFor(profile, "dedicated");
      if (!model) {
        return {
          configured: true,
          ok: false,
          source: "embedding",
          error: `向量方案「${profile.name}」还没有填写模型名`,
        };
      }
      return validate(profile, model, "embedding");
    }

    const attached: readonly (readonly ["aux" | "narrator", string | undefined])[] = [
      ["aux", this.pick.aux ?? state.config.aux],
      ["narrator", this.pick.narrator ?? state.config.narrator],
    ];
    for (const [source, name] of attached) {
      if (!name) continue;
      const profile = state.config.profiles.find((p) => p.name === name);
      if (!profile) continue;
      const model = embeddingModelFor(profile, "attached");
      if (!model) continue;
      return validate(profile, model, source);
    }

    return { configured: false, ok: false, error: null };
  }

  /** 为旧记忆语义检索解析可选的 embedding 客户端（带按存档持久化缓存） */
  async resolveEmbedder(
    onWarn?: (message: string) => void,
    options?: { readonly saveId?: string; readonly cache?: EmbeddingCacheStore | undefined },
  ): Promise<Embedder | undefined> {
    const target = await this.resolveEmbeddingTarget();
    if (!target.configured) return undefined;
    if (!target.ok) {
      onWarn?.(`${target.error}，本轮降级为规则检索`);
      return undefined;
    }
    const base = createEmbedder(
      target.profile,
      this.config.keyFor(target.profile),
      target.model,
      onWarn,
    );
    if (!base) return undefined;
    if (options?.saveId && options.cache) {
      return options.cache.wrap(options.saveId, target.modelKey, base);
    }
    return base;
  }

  /** 解析独立语义重排模型（config.reranker） */
  async resolveRerankerTarget(): Promise<ResolvedRerankerTarget> {
    const state = await this.config.load();
    if (state.status !== "ok" || !state.config.reranker) {
      return { configured: false, ok: false, error: null };
    }
    const profile = state.config.profiles.find((p) => p.name === state.config.reranker);
    if (!profile) {
      return {
        configured: true,
        ok: false,
        error: `重排模型指向的方案「${state.config.reranker}」不存在`,
      };
    }
    if (!isRerankProviderType(profile.type)) {
      return {
        configured: true,
        ok: false,
        error: `重排方案「${profile.name}」（${profile.type}）不支持 /rerank 接口，请改用 OpenAI 兼容或 Ollama 连接`,
      };
    }
    const model = state.config.roleModels?.reranker?.trim() || profile.model.trim();
    if (!model) {
      return {
        configured: true,
        ok: false,
        error: `重排方案「${profile.name}」还没有填写模型名`,
      };
    }
    const key = this.config.keyFor(profile);
    if (profile.type === "openai" && !key) {
      return {
        configured: true,
        ok: false,
        error: `重排方案「${profile.name}」还没有填写 API 密钥`,
      };
    }
    if (!rerankUrl(profile)) {
      return {
        configured: true,
        ok: false,
        error: `重排方案「${profile.name}」的接口地址无效`,
      };
    }
    return { configured: true, ok: true, profile, model };
  }

  /** 为二阶段旧记忆精排解析可选的 reranker 客户端 */
  async resolveReranker(onWarn?: (message: string) => void): Promise<Reranker | undefined> {
    const target = await this.resolveRerankerTarget();
    if (!target.configured) return undefined;
    if (!target.ok) {
      onWarn?.(`${target.error}，本轮跳过二阶段重排`);
      return undefined;
    }
    return createReranker(target.profile, this.config.keyFor(target.profile), target.model, onWarn);
  }

  async *stream(request: LlmRequest, signal?: AbortSignalLike): AsyncGenerator<LlmEvent> {
    const resolved = await this.resolve(request.purpose);
    if (!resolved.ok) throw new UpstreamError(resolved.error);
    yield* resolved.client.stream(request, signal);
  }
}
