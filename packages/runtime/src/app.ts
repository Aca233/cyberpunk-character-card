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

const MAX_RUNTIME_LOGS = 250;

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
    images: deps.images,
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
    const [
      narrator,
      aux,
      image,
      embedding,
      reranker,
      activePreset,
      allPresets,
      workshopResult,
      charactersResult,
      savesResult,
    ] = await Promise.all([
      llm.resolve("narrator"),
      llm.resolve("aux"),
      imageRouter.resolve(),
      llm.resolveEmbeddingTarget(),
      llm.resolveRerankerTarget(),
      deps.presets ? deps.presets.active().catch(() => undefined) : Promise.resolve(undefined),
      deps.presets ? deps.presets.list().catch(() => []) : Promise.resolve([]),
      deps.workshop
        ? deps.workshop
            .list()
            .then((packs) => ({ ok: true as const, packs }))
            .catch((error) => ({
              ok: false as const,
              error: error instanceof Error ? error.message : String(error),
            }))
        : Promise.resolve({ ok: true as const, packs: [] }),
      deps.characters
        .list()
        .then((list) => ({ ok: true as const, list }))
        .catch((error) => ({
          ok: false as const,
          error: error instanceof Error ? error.message : String(error),
        })),
      game
        .list()
        .then((list) => ({ ok: true as const, list }))
        .catch((error) => ({
          ok: false as const,
          error: error instanceof Error ? error.message : String(error),
        })),
    ]);
    const redact = await deps.config.redactor();
    const saveIdRaw = c.req.query("saveId")?.trim();
    const turnsRaw = Number.parseInt(c.req.query("turns") ?? "10", 10);
    const turns = Number.isInteger(turnsRaw) ? Math.max(1, Math.min(30, turnsRaw)) : 10;
    const includeThought = c.req.query("includeThought") !== "0";
    const includePrompt = c.req.query("includePrompt") === "1";
    const includeWorldState = c.req.query("includeWorldState") !== "0";
    const includeImages = c.req.query("includeImages") !== "0";

    let save: Record<string, unknown> | null = null;
    let saveError: string | null = null;
    if (saveIdRaw) {
      if (!isSaveId(saveIdRaw)) {
        saveError = "存档 id 不合法";
      } else {
        try {
          save = await game.diagnostics(saveIdRaw, {
            turns,
            includeThought,
            includePrompt,
            includeWorldState,
          });
        } catch (error) {
          saveError =
            error instanceof SaveNotFoundError
              ? "没有找到该存档"
              : redact(error instanceof Error ? error.message : String(error));
        }
      }
    }

    let images: Record<string, unknown> | null = null;
    if (includeImages && deps.images) {
      try {
        const [recent, saveBindings] = await Promise.all([
          deps.images.listRecentMetadata(15),
          saveIdRaw && isSaveId(saveIdRaw)
            ? deps.images.getBindings(saveIdRaw).catch(() => null)
            : Promise.resolve(null),
        ]);
        images = { recent, saveBindings };
      } catch (error) {
        images = {
          error: redact(error instanceof Error ? error.message : String(error)),
        };
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
              roleModels: state.config.roleModels ?? null,
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
                embeddingModel: pub.embeddingModel ?? null,
                imageProtocol: pub.imageProtocol ?? null,
              };
            }),
          }
        : { status: state.status, errors: state.errors };

    return c.json({
      schemaVersion: "cp-diagnostic-v2",
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
          protocol: image.ok ? image.protocol : null,
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
            enabledEntryList: activePreset.entries
              .filter((e) => e.enabled)
              .map((e) => ({
                id: e.id,
                name: e.name,
                role: e.role,
                depth: e.depth,
                chars: e.content.length,
              })),
            enabledRegex: activePreset.regex
              .filter((r) => r.enabled)
              .map((r) => ({
                id: r.id,
                name: r.name,
                flags: r.flags,
                promptOnly: r.promptOnly,
              })),
          }
        : null,
      presets: allPresets.map((p) => ({
        id: p.id,
        name: p.preset.name,
        importedAt: p.importedAt,
        entryCount: p.preset.entries.length,
        enabledEntries: p.preset.entries.filter((e) => e.enabled).length,
        regexCount: p.preset.regex.length,
        enabledRegexCount: p.preset.regex.filter((r) => r.enabled).length,
        warnings: p.warnings,
      })),
      workshop: workshopResult.ok
        ? {
            packs: workshopResult.packs.map((entry) => ({
              id: entry.pack.id,
              title: entry.pack.title,
              author: entry.pack.author,
              version: entry.pack.version,
              enabled: entry.enabled,
              installedAt: entry.installedAt,
              counts: {
                modules: entry.pack.modules.length,
                acquaintances: entry.pack.acquaintances.length,
                npcs: entry.pack.npcs.length,
                items: entry.pack.items.length,
                cyberware: entry.pack.cyberware.length,
                braindances: entry.pack.braindances.length,
                chipContents: entry.pack.chipContents.length,
                shopListings: entry.pack.shopListings.length,
                ripperdocListings: entry.pack.ripperdocListings.length,
              },
            })),
          }
        : { error: redact(workshopResult.error) },
      characters: charactersResult.ok
        ? {
            total: charactersResult.list.length,
            custom: charactersResult.list.filter((entry) => !entry.sample).length,
            list: charactersResult.list.map((entry) => ({
              id: entry.id,
              name: entry.card.name,
              sample: entry.sample,
              updatedAt: entry.updatedAt,
              origin: entry.card.origin || null,
              cyberwareCount: entry.card.board?.cyberware.length ?? 0,
              moduleCount: entry.card.board
                ? (entry.card.board.origin ? 1 : 0) +
                  entry.card.board.pasts.length +
                  entry.card.board.skills.length +
                  entry.card.board.flaws.length
                : 0,
              hasPortrait: Boolean(entry.card.portrait),
            })),
          }
        : { error: redact(charactersResult.error) },
      savesSummary: savesResult.ok ? savesResult.list : { error: redact(savesResult.error) },
      images,
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
