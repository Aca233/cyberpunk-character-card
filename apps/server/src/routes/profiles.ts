import type { LlmUsage } from "@cp/core";
import { type Context, Hono } from "hono";
import type { ConfigService, Result } from "../config";
import { LlmRouter } from "../providers/index";

/** 测试连接最多等这么久 */
const TEST_TIMEOUT_MS = 30_000;

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
