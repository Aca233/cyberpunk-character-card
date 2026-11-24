import { glossary } from "@cp/content";
import type { Clock, Rng } from "@cp/core";
import { Hono } from "hono";
import type { CharacterStore } from "./characters";
import { TurnCheckpointStore } from "./checkpoints";
import type { ConfigService } from "./config";
import { EmbeddingCacheStore } from "./embedding-cache";
import { GameService } from "./game";
import type { ImageStore } from "./images";
import type { SaveStorage } from "./ports";
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

export function createApp(deps: AppDeps): Hono {
  const hub = deps.hub ?? new TurnHub();
  const clock = deps.clock ?? { now: () => new Date() };
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
    log: deps.log,
    presets: deps.presets,
    checkpoints,
    embeddingCache,
    workshop: deps.workshop,
  });
  const app = new Hono();
  app.onError(async (error, c) => {
    const redact = await deps.config.redactor();
    deps.log(`接口出错：${redact(error.stack ?? error.message)}`);
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
