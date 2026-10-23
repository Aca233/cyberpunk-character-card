import { Hono } from "hono";
import type { ConfigService } from "../config";

export function profileRoutes(config: ConfigService): Hono {
  const routes = new Hono();
  routes.get("/", async (c) => c.json(await config.overview()));
  routes.put("/:name", async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    if (body === undefined) return c.json({ error: "请求体不是合法的 JSON" }, 400);
    const result = await config.updateProfile(c.req.param("name"), body);
    return result.ok
      ? c.json({ profile: result.profile })
      : c.json({ error: result.error }, result.status);
  });
  return routes;
}
