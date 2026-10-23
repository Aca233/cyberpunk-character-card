import type { LlmUsage } from "@cp/core";
import { Hono } from "hono";
import type { ConfigService } from "../config";
import { LlmRouter } from "../providers/index";

/** 测试连接最多等这么久 */
const TEST_TIMEOUT_MS = 30_000;

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
  /** 测试连接：用这个方案发一条很短的请求，会产生极少量费用；报错先去掉密钥 */
  routes.post("/:name/test", async (c) => {
    const name = c.req.param("name");
    const redact = await config.redactor();
    const resolved = await new LlmRouter(config, { gm: name }).resolve("gm");
    if (!resolved.ok) return c.json({ ok: false, error: redact(resolved.error) });
    const started = Date.now();
    let reply = "";
    let usage: LlmUsage | undefined;
    try {
      for await (const event of resolved.client.stream(
        {
          purpose: "gm",
          temperature: 0,
          maxOutputTokens: 64,
          messages: [{ role: "user", content: "连接测试：只回复 OK。" }],
        },
        AbortSignal.timeout(TEST_TIMEOUT_MS),
      )) {
        if (event.type === "text") reply += event.text;
        else if (event.type === "blocked") {
          return c.json({ ok: false, error: `请求被拦截：${redact(event.reason)}` });
        } else usage = event.usage;
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
