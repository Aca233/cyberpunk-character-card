import { glossary } from "@cp/content";
import type { Clock, Rng } from "@cp/core";
import { Hono } from "hono";
import type { CharacterStore } from "./characters";
import { TurnCheckpointStore } from "./checkpoints";
import type { ConfigService } from "./config";
import { EmbeddingCacheStore } from "./embedding-cache";
import { GameService } from "./game";
import type { ImageStore } from "./images";
import { isSaveId, SaveNotFoundError, type SaveStorage } from "./ports";
import type { PresetStore } from "./presets";
import { ImageRouter, imageProtocolCapabilities } from "./providers/image";
import { LlmRouter } from "./providers/index";
import { cryptoRng } from "./random";
import { characterRoutes } from "./routes/characters";
import { imageRoutes, saveImageRoutes } from "./routes/images";
import { presetRoutes } from "./routes/presets";
import { profileRoutes } from "./routes/profiles";
import { saveRoutes } from "./routes/saves";
import { workshopRoutes } from "./routes/workshop";
import { TurnHub } from "./turns";
import type { WorkshopStore } from "./workshop";

export interface AppDeps {
  readonly config: ConfigService;
  readonly saves: SaveStorage;
  readonly characters: CharacterStore;
  /** 写控制台日志；传进来的文本已经去掉密钥 */
  readonly log: (message: string) => void;
  readonly clock?: Clock;
  readonly hub?: TurnHub;
  /** 测试时可以换成固定骰子 */
  readonly rng?: Rng;
  /** 玩家导入的酒馆预设；不传时没有预设接口，写正文也不套预设 */
  readonly presets?: PresetStore | undefined;
  /** 文生图存储；传了才开放 /api/images 与存档图片绑定 */
  readonly images?: ImageStore | undefined;
  /** 回合阶段断点存储；传了可跨刷新保存中间阶段结果 */
  readonly checkpoints?: TurnCheckpointStore | undefined;
  /** 本地持久化向量缓存；传了按存档复用旧记忆向量，未传则仅用内存缓存 */
  readonly embeddingCache?: EmbeddingCacheStore | undefined;
  readonly workshop?: WorkshopStore | undefined;
}

const MAX_RUNTIME_LOGS = 120;

function sanitizeBaseUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "(invalid-url)";
  }
}

export function createApp(deps: AppDeps): Hono {
  const hub = deps.hub ?? new TurnHub();
  const clock = deps.clock ?? { now: () => new Date() };
  const runtimeLogs: { readonly at: string; readonly message: string }[] = [];
  const log = (message: string) => {
    runtimeLogs.push({ at: clock.now().toISOString(), message: message.slice(0, 2000) });
    if (runtimeLogs.length > MAX_RUNTIME_LOGS) runtimeLogs.shift();
    deps.log(message);
  };
  const llm = new LlmRouter(deps.config);
  const imageRouter = new ImageRouter(deps.config);
  const checkpoints = deps.checkpoints ?? new TurnCheckpointStore();
  const embeddingCache = deps.embeddingCache ?? new EmbeddingCacheStore();
  const game = new GameService({
    saves: deps.saves,
    characters: deps.characters,
    config: deps.config,
    llm,
    hub,
    clock,
    rng: deps.rng ?? cryptoRng,
    log,
    presets: deps.presets,
    checkpoints,
    embeddingCache,
    workshop: deps.workshop,
  });
  const app = new Hono();
  app.onError(async (error, c) => {
    const redact = await deps.config.redactor();
    log(`接口出错：${redact(error.stack ?? error.message)}`);
    return c.json({ error: "内部处理错误，详情见浏览器控制台" }, 500);
  });
  app.notFound((c) => c.json({ error: `没有这个接口：${c.req.method} ${c.req.path}` }, 404));
  app.get("/api/health", async (c) => {
    const state = await deps.config.load();
    const [narrator, aux, image, embedding, reranker] = await Promise.all([
      llm.resolve("narrator"),
      llm.resolve("aux"),
      imageRouter.resolve(),
      llm.resolveEmbeddingTarget(),
      llm.resolveRerankerTarget(),
    ]);
    const redact = await deps.config.redactor();
    return c.json({
      ok: true,
      config: state.status,
      models: {
        ready: narrator.ok && aux.ok,
        narrator: { ready: narrator.ok, error: narrator.ok ? null : redact(narrator.error) },
        aux: { ready: aux.ok, error: aux.ok ? null : redact(aux.error) },
        image: {
          ready: image.ok,
          error: image.ok ? null : redact(image.error),
          capabilities: image.ok ? imageProtocolCapabilities(image.protocol) : null,
        },
        embedding: {
          ready: embedding.ok,
          configured: embedding.configured,
          model: embedding.ok ? embedding.model : null,
          error: embedding.configured && !embedding.ok ? redact(embedding.error) : null,
        },
        reranker: {
          ready: reranker.ok,
          configured: reranker.configured,
          model: reranker.ok ? reranker.model : null,
          error: reranker.configured && !reranker.ok ? redact(reranker.error) : null,
        },
      },
    });
  });
  app.get("/api/diagnostics", async (c) => {
    const state = await deps.config.load();
    const [narrator, aux, image, embedding, reranker, activePreset] = await Promise.all([
      llm.resolve("narrator"),
      llm.resolve("aux"),
      imageRouter.resolve(),
      llm.resolveEmbeddingTarget(),
      llm.resolveRerankerTarget(),
      deps.presets ? deps.presets.active().catch(() => undefined) : Promise.resolve(undefined),
    ]);
    const redact = await deps.config.redactor();
    const saveIdRaw = c.req.query("saveId")?.trim();
    const turnsRaw = Number.parseInt(c.req.query("turns") ?? "8", 10);
    const turns = Number.isInteger(turnsRaw) ? Math.max(1, Math.min(30, turnsRaw)) : 8;
    const includeThought = c.req.query("includeThought") !== "0";
    const includePrompt = c.req.query("includePrompt") === "1";

    let save: Record<string, unknown> | null = null;
    let saveError: string | null = null;
    if (saveIdRaw) {
      if (!isSaveId(saveIdRaw)) {
        saveError = "存档 id 不合法";
      } else {
        try {
          save = await game.diagnostics(saveIdRaw, { turns, includeThought, includePrompt });
        } catch (error) {
          saveError =
            error instanceof SaveNotFoundError
              ? "没有找到该存档"
              : redact(error instanceof Error ? error.message : String(error));
        }
      }
    }

    const profiles =
      state.status === "ok"
        ? {
            roles: {
              narrator: state.config.narrator ?? null,
              aux: state.config.aux ?? null,
              image: state.config.image ?? null,
              embedding: state.config.embedding ?? null,
              reranker: state.config.reranker ?? null,
            },
            list: state.config.profiles.map((p) => {
              const pub = deps.config.publicProfile(p);
              return {
                name: pub.name,
                type: pub.type,
                model: pub.model,
                baseUrl: sanitizeBaseUrl(pub.baseUrl),
                keyStatus: pub.keyStatus,
                temperature: pub.temperature ?? null,
                maxOutputTokens: pub.maxOutputTokens ?? null,
                contextWindow: pub.contextWindow ?? null,
                imageProtocol: pub.imageProtocol ?? null,
              };
            }),
          }
        : { status: state.status, errors: state.errors };

    return c.json({
      schemaVersion: "cp-diagnostic-v1",
      generatedAt: clock.now().toISOString(),
      health: {
        config: state.status,
        ready: narrator.ok && aux.ok,
        narrator: {
          ready: narrator.ok,
          model: narrator.ok ? narrator.profile.model : null,
          error: narrator.ok ? null : redact(narrator.error),
        },
        aux: {
          ready: aux.ok,
          model: aux.ok ? aux.profile.model : null,
          error: aux.ok ? null : redact(aux.error),
        },
        image: {
          ready: image.ok,
          model: image.ok ? image.profile.model : null,
          error: image.ok ? null : redact(image.error),
        },
        embedding: {
          ready: embedding.ok,
          configured: embedding.configured,
          model: embedding.ok ? embedding.model : null,
          error: embedding.configured && !embedding.ok ? redact(embedding.error) : null,
        },
        reranker: {
          ready: reranker.ok,
          configured: reranker.configured,
          model: reranker.ok ? reranker.model : null,
          error: reranker.configured && !reranker.ok ? redact(reranker.error) : null,
        },
      },
      profiles,
      activePreset: activePreset
        ? {
            name: activePreset.name,
            entryCount: activePreset.entries.length,
            enabledEntries: activePreset.entries.filter((e) => e.enabled).length,
            sampling: activePreset.sampling ?? null,
          }
        : null,
      runtimeLogs: runtimeLogs.map((entry) => ({
        at: entry.at,
        message: redact(entry.message),
      })),
      save,
      saveError,
    });
  });
  app.get("/api/glossary", (c) => c.json({ glossary }));
  app.route("/api/profiles", profileRoutes(deps.config));
  if (deps.presets) app.route("/api/presets", presetRoutes(deps.presets, clock));
  if (deps.images) {
    app.route("/api/images", imageRoutes(deps.images, imageRouter, llm, deps.config, clock));
    app.route("/api/saves", saveImageRoutes(deps.images));
  }
  app.route("/api/characters", characterRoutes(deps.characters, clock, llm, deps.workshop));
  if (deps.workshop) app.route("/api/workshop", workshopRoutes(deps.workshop, clock));
  app.route("/api/saves", saveRoutes(game, hub));
  return app;
}
