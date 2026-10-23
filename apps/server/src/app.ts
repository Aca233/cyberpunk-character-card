import type { Clock, Rng } from "@cp/core";
import { Hono } from "hono";
import type { ConfigService } from "./config";
import { GameService } from "./game";
import { LlmRouter } from "./providers/index";
import { cryptoRng } from "./rng";
import { profileRoutes } from "./routes/profiles";
import { saveRoutes } from "./routes/saves";
import type { SaveStore } from "./storage";
import { TurnHub } from "./turns";

export interface AppDeps {
  readonly config: ConfigService;
  readonly saves: SaveStore;
  readonly dev: boolean;
  /** 写后端日志；传进来的文本已经去掉密钥 */
  readonly log: (message: string) => void;
  readonly clock?: Clock;
  readonly hub?: TurnHub;
  /** 测试时可以换成固定骰子 */
  readonly rng?: Rng;
}

export function createApp(deps: AppDeps): Hono {
  const hub = deps.hub ?? new TurnHub();
  const game = new GameService({
    saves: deps.saves,
    config: deps.config,
    llm: new LlmRouter(deps.config),
    hub,
    clock: deps.clock ?? { now: () => new Date() },
    rng: deps.rng ?? cryptoRng,
    log: deps.log,
  });
  const app = new Hono();
  app.onError(async (error, c) => {
    const redact = await deps.config.redactor();
    deps.log(`接口出错：${redact(error.stack ?? error.message)}`);
    return c.json({ error: "服务器内部错误，详情见后端日志" }, 500);
  });
  app.notFound((c) => c.json({ error: `没有这个接口：${c.req.method} ${c.req.path}` }, 404));
  app.get("/api/health", async (c) => {
    const state = await deps.config.load();
    return c.json({ ok: true, config: state.status, dev: deps.dev });
  });
  app.route("/api/profiles", profileRoutes(deps.config));
  app.route("/api/saves", saveRoutes(game, hub));
  return app;
}
