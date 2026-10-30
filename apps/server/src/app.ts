import { glossary } from "@cp/content";
import type { Clock, LoreSource, Rng } from "@cp/core";
import { Hono } from "hono";
import type { AuthoringStore } from "./authoring";
import type { AuthoringTextSearch } from "./authoring-search";
import type { CharacterStore } from "./characters";
import type { ConfigService } from "./config";
import { GameService } from "./game";
import type { PresetStore } from "./presets";
import { LlmRouter } from "./providers/index";
import { cryptoRng } from "./rng";
import { authoringRoutes } from "./routes/authoring";
import { characterRoutes } from "./routes/characters";
import { presetRoutes } from "./routes/presets";
import { profileRoutes } from "./routes/profiles";
import { saveRoutes } from "./routes/saves";
import type { SaveStore } from "./storage";
import { TurnHub } from "./turns";

export interface AppDeps {
  readonly config: ConfigService;
  readonly saves: SaveStore;
  readonly characters: CharacterStore;
  readonly dev: boolean;
  /** 写后端日志；传进来的文本已经去掉密钥 */
  readonly log: (message: string) => void;
  readonly clock?: Clock;
  readonly hub?: TurnHub;
  /** 测试时可以换成固定骰子 */
  readonly rng?: Rng;
  /** 「存为评测用例」写草稿的目录 */
  readonly evalDrafts?: string | undefined;
  /** 本机内容工坊；非开发模式即使传入也不挂载接口。 */
  readonly authoring?: AuthoringStore | undefined;
  readonly authoringText?: AuthoringTextSearch | undefined;
  /** 设定库：本机官方文本库的只读检索；没有文本库时不传 */
  readonly lore?: LoreSource | undefined;
  /** 玩家导入的酒馆预设（用户定的）；不传时没有预设接口，写正文也不套预设 */
  readonly presets?: PresetStore | undefined;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** 只认本机地址：挡住 DNS 重绑定，以及别的网站借浏览器往本机接口发请求（会改配置、写密钥） */
function fromLocalPage(url: string, origin: string | undefined, fetchSite: string | undefined) {
  if (!LOOPBACK.has(new URL(url).hostname)) return false;
  if (fetchSite === "cross-site") return false;
  if (origin === undefined) return true;
  try {
    return LOOPBACK.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

export function createApp(deps: AppDeps): Hono {
  const hub = deps.hub ?? new TurnHub();
  const clock = deps.clock ?? { now: () => new Date() };
  const llm = new LlmRouter(deps.config);
  const game = new GameService({
    saves: deps.saves,
    characters: deps.characters,
    config: deps.config,
    llm,
    hub,
    clock,
    rng: deps.rng ?? cryptoRng,
    log: deps.log,
    evalDrafts: deps.evalDrafts,
    lore: deps.lore,
    presets: deps.presets,
  });
  const app = new Hono();
  app.onError(async (error, c) => {
    const redact = await deps.config.redactor();
    deps.log(`接口出错：${redact(error.stack ?? error.message)}`);
    return c.json({ error: "服务器内部错误，详情见后端日志" }, 500);
  });
  app.notFound((c) => c.json({ error: `没有这个接口：${c.req.method} ${c.req.path}` }, 404));
  app.use("/api/*", async (c, next) => {
    if (!fromLocalPage(c.req.url, c.req.header("origin"), c.req.header("sec-fetch-site"))) {
      return c.json({ error: "只接受本机页面的请求" }, 403);
    }
    await next();
  });
  app.get("/api/health", async (c) => {
    const state = await deps.config.load();
    const [narrator, aux] = await Promise.all([llm.resolve("narrator"), llm.resolve("aux")]);
    const redact = await deps.config.redactor();
    return c.json({
      ok: true,
      config: state.status,
      dev: deps.dev,
      models: {
        ready: narrator.ok && aux.ok,
        narrator: { ready: narrator.ok, error: narrator.ok ? null : redact(narrator.error) },
        aux: { ready: aux.ok, error: aux.ok ? null : redact(aux.error) },
      },
    });
  });
  app.get("/api/glossary", (c) => c.json({ glossary }));
  app.route("/api/profiles", profileRoutes(deps.config));
  // 酒馆预设接口沿用上面的本机来源校验；导入和切换不发送模型请求。
  if (deps.presets) app.route("/api/presets", presetRoutes(deps.presets, clock));
  app.route("/api/characters", characterRoutes(deps.characters, clock, llm));
  app.route("/api/saves", saveRoutes(game, hub, deps.dev === true));
  if (deps.dev && deps.authoring) {
    app.route(
      "/api/dev/authoring",
      authoringRoutes(deps.authoring, clock, deps.authoringText, llm),
    );
  }
  return app;
}
