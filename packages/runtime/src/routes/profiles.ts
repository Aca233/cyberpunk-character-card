import type { LlmUsage } from "@cp/core";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { type ConfigService, ProviderTypeSchema, type Result, redact } from "../config";
import { embeddingModelFor, probeEmbedding } from "../providers/embedding";
import { AbortedError } from "../providers/http";
import { ImageRouter } from "../providers/image";
import { LlmRouter } from "../providers/index";
import { fetchProviderModels } from "../providers/models";
import { probeReranker } from "../providers/rerank";

/** 测试连接最多等这么久 */
const TEST_TIMEOUT_MS = 30_000;
const IMAGE_TEST_TIMEOUT_MS = 60_000;
const MODELS_TIMEOUT_MS = 15_000;

const FetchModelsBodySchema = z.object({
  profileName: z.string().trim().min(1).optional(),
  type: ProviderTypeSchema.optional(),
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
});

async function readBody(c: Context): Promise<unknown> {
  return c.req.json().catch(() => undefined);
}

function badJson(c: Context) {
  return c.json({ error: "请求体不是合法的 JSON" }, 400);
}

function send<T>(c: Context, result: Result<T>, body: (value: T) => object) {
  return result.ok ? c.json(body(result.value)) : c.json({ error: result.error }, result.status);
}

export function profileRoutes(config: ConfigService): Hono {
  const routes = new Hono();
  routes.get("/", async (c) => c.json(await config.overview()));

  // 以 - 开头的路径不会和方案名冲突：设置页新建的方案名只能以字母或数字开头
  routes.post("/-/init", async (c) => send(c, await config.init(), () => ({ ok: true })));
  routes.put("/-/roles", async (c) => {
    const body = await readBody(c);
    if (body === undefined) return badJson(c);
    return send(c, await config.setRoles(body), (roles) => roles);
  });
  /** 拉取模型列表：支持传入表单未保存的参数，或复用已保存连接的密钥（只进不出） */
  routes.post("/-/models", async (c) => {
    const body = await readBody(c);
    if (body === undefined) return badJson(c);
    const parsed = FetchModelsBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ ok: false, error: parsed.error.issues[0]?.message ?? "请求参数格式有误" });
    }
    const { profileName, type: rawType, baseUrl: rawBaseUrl, apiKey: rawKey } = parsed.data;
    const state = profileName ? await config.load() : undefined;
    const existing =
      state?.status === "ok"
        ? state.config.profiles.find((p) => p.name === profileName)
        : undefined;
    if (profileName && !existing) {
      return c.json({ ok: false, error: `找不到连接「${profileName}」` });
    }
    const type = rawType ?? existing?.type;
    if (!type) return c.json({ ok: false, error: "请先选择提供方类型或连接" });
    const baseUrl = rawBaseUrl !== undefined ? rawBaseUrl : existing?.baseUrl;
    const suppliedKey = rawKey?.trim() ?? "";
    const apiKey = suppliedKey || (existing ? await config.keyFor(existing) : undefined);
    const rawSecrets = await config.secrets();
    const secrets = suppliedKey ? [...rawSecrets, suppliedKey] : rawSecrets;
    try {
      const models = await fetchProviderModels(
        {
          type,
          ...(baseUrl !== undefined ? { baseUrl } : {}),
          ...(apiKey !== undefined ? { apiKey } : {}),
        },
        AbortSignal.timeout(MODELS_TIMEOUT_MS),
      );
      return c.json({ ok: true, models });
    } catch (error) {
      const message =
        error instanceof AbortedError || (error instanceof Error && error.name === "TimeoutError")
          ? "获取模型列表超时，请检查网络或接口地址"
          : error instanceof Error
            ? error.message
            : String(error);
      return c.json({ ok: false, error: redact(message, secrets) });
    }
  });

  routes.post("/", async (c) => {
    const body = await readBody(c);
    if (body === undefined) return badJson(c);
    return send(c, await config.addProfile(body), (profile) => ({ profile }));
  });
  routes.put("/:name", async (c) => {
    const body = await readBody(c);
    if (body === undefined) return badJson(c);
    return send(c, await config.updateProfile(c.req.param("name"), body), (profile) => ({
      profile,
    }));
  });
  routes.delete("/:name", async (c) =>
    send(c, await config.removeProfile(c.req.param("name")), () => ({ ok: true })),
  );

  /** 密钥只进不出：存进 config.json，接口只回方案的公开信息，日志里也不写 */
  routes.put("/:name/key", async (c) => {
    const body = await readBody(c);
    if (body === undefined) return badJson(c);
    const apiKey =
      typeof body === "object" && body !== null ? (body as { apiKey?: unknown }).apiKey : undefined;
    return send(c, await config.setKey(c.req.param("name"), apiKey), (profile) => ({ profile }));
  });
  routes.delete("/:name/key", async (c) =>
    send(c, await config.clearKey(c.req.param("name")), (profile) => ({ profile })),
  );

  /** 测试连接：会产生模型费用（可能包含思考 token）；报错先去掉密钥，不自动重试 */
  routes.post("/:name/test", async (c) => {
    const name = c.req.param("name");
    const redact = await config.redactor();
    const overview = await config.load();
    const profile =
      overview.status === "ok" ? overview.config.profiles.find((p) => p.name === name) : undefined;
    if (profile && (profile.type === "sdwebui" || profile.type === "comfyui")) {
      const started = Date.now();
      try {
        const models = await fetchProviderModels(
          {
            type: profile.type,
            ...(profile.baseUrl !== undefined ? { baseUrl: profile.baseUrl } : {}),
            apiKey: config.keyFor(profile),
          },
          AbortSignal.timeout(MODELS_TIMEOUT_MS),
        );
        return c.json({
          ok: true,
          model: profile.model,
          ms: Date.now() - started,
          reply: `连通成功，检测到 ${models.length} 个可用模型`,
        });
      } catch (error) {
        return c.json({
          ok: false,
          error: redact(error instanceof Error ? error.message : String(error)),
          ms: Date.now() - started,
        });
      }
    }
    const imageOnly =
      overview.status === "ok" &&
      profile !== undefined &&
      (profile.type === "novelai" ||
        (profile.imageProtocol !== undefined && profile.imageProtocol !== "auto") ||
        (overview.config.image === name &&
          overview.config.narrator !== name &&
          overview.config.aux !== name));
    if (imageOnly) {
      const started = Date.now();
      try {
        const result = await new ImageRouter(config).generate(
          {
            prompt: "minimalist cyberpunk neon triangle emblem on dark background",
            aspectRatio: "1:1",
          },
          AbortSignal.timeout(IMAGE_TEST_TIMEOUT_MS),
          name,
        );
        return c.json({
          ok: true,
          model: profile.model,
          ms: Date.now() - started,
          reply: `生图测试成功（${result.mimeType}）`,
        });
      } catch (error) {
        return c.json({
          ok: false,
          error: redact(error instanceof Error ? error.message : String(error)),
          ms: Date.now() - started,
        });
      }
    }
    const embeddingOnly =
      overview.status === "ok" &&
      profile !== undefined &&
      overview.config.embedding === name &&
      overview.config.narrator !== name &&
      overview.config.aux !== name &&
      overview.config.image !== name &&
      overview.config.reranker !== name;
    if (embeddingOnly) {
      const started = Date.now();
      const targetModel = embeddingModelFor(profile, "dedicated");
      if (!targetModel) {
        return c.json({ ok: false, error: "向量连接还没有填写模型名" });
      }
      try {
        const probed = await probeEmbedding(
          profile,
          config.keyFor(profile),
          targetModel,
          AbortSignal.timeout(TEST_TIMEOUT_MS),
        );
        return c.json({
          ok: true,
          model: probed.model,
          ms: Date.now() - started,
          reply: `向量嵌入测试成功（维度 ${probed.dimensions}）`,
        });
      } catch (error) {
        return c.json({
          ok: false,
          error: redact(error instanceof Error ? error.message : String(error)),
          ms: Date.now() - started,
        });
      }
    }
    const rerankerOnly =
      overview.status === "ok" &&
      profile !== undefined &&
      overview.config.reranker === name &&
      overview.config.narrator !== name &&
      overview.config.aux !== name &&
      overview.config.image !== name &&
      overview.config.embedding !== name;
    if (rerankerOnly) {
      const started = Date.now();
      const targetModel = profile.model.trim();
      if (!targetModel) {
        return c.json({ ok: false, error: "重排连接还没有填写模型名" });
      }
      try {
        const probed = await probeReranker(
          profile,
          config.keyFor(profile),
          targetModel,
          AbortSignal.timeout(TEST_TIMEOUT_MS),
        );
        return c.json({
          ok: true,
          model: probed.model,
          ms: Date.now() - started,
          reply: `语义重排测试成功（返回 ${probed.count} 条，最高相关度 ${probed.topScore.toFixed(2)}）`,
        });
      } catch (error) {
        return c.json({
          ok: false,
          error: redact(error instanceof Error ? error.message : String(error)),
          ms: Date.now() - started,
        });
      }
    }
    const resolved = await new LlmRouter(config, { narrator: name }).resolve("narrator");
    if (!resolved.ok) return c.json({ ok: false, error: redact(resolved.error) });
    const started = Date.now();
    let reply = "";
    let usage: LlmUsage | undefined;
    try {
      for await (const event of resolved.client.stream(
        {
          purpose: "narrator",
          temperature: 0,
          // Gemini 的输出额度包含思考 token，不能固定压到 64。
          // 测试最多用 2048；用户配置更低时尊重配置，不偷偷提高。
          maxOutputTokens:
            resolved.profile.type === "gemini"
              ? Math.min(resolved.profile.maxOutputTokens ?? 2048, 2048)
              : 64,
          messages: [{ role: "user", content: "连接测试：只回复 OK。" }],
        },
        AbortSignal.timeout(TEST_TIMEOUT_MS),
      )) {
        if (event.type === "text") reply += event.text;
        else if (event.type === "blocked") {
          return c.json({ ok: false, error: `请求被拦截：${redact(event.reason)}` });
        } else if (event.type === "done") usage = event.usage;
      }
    } catch (error) {
      return c.json({
        ok: false,
        error: redact(error instanceof Error ? error.message : String(error)),
        ms: Date.now() - started,
      });
    }
    return c.json({
      ok: true,
      model: resolved.profile.model,
      ms: Date.now() - started,
      reply: redact(reply.trim().slice(0, 80)),
      ...(usage ? { usage } : {}),
    });
  });
  return routes;
}
