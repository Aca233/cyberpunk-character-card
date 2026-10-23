import { Hono } from "hono";
import type { ConfigService } from "./config";
import { profileRoutes } from "./routes/profiles";
import type { SaveStore } from "./storage";

export interface AppDeps {
  readonly config: ConfigService;
  readonly saves: SaveStore;
  readonly dev: boolean;
  /** 写后端日志；传进来的文本已经去掉密钥 */
  readonly log: (message: string) => void;
}

export function createApp(deps: AppDeps): Hono {
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
  return app;
}
