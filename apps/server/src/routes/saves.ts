import { TurnRequestSchema } from "@cp/core";
import type { Context } from "hono";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { z } from "zod";
import { CreateSaveSchema, type GameService, type Reply } from "../game";
import { isSaveId, SaveExistsError, SaveNotFoundError } from "../storage";
import type { TurnHub } from "../turns";

function issues(error: z.ZodError): string[] {
  return error.issues.map((i) =>
    i.path.length > 0 ? `${i.path.join(".")}：${i.message}` : i.message,
  );
}

async function body<T extends z.ZodType>(
  c: Context,
  schema: T,
): Promise<{ ok: true; value: z.output<T> } | { ok: false; errors: string[] }> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return { ok: false, errors: ["请求体不是合法的 JSON"] };
  }
  const parsed = schema.safeParse(raw);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, errors: issues(parsed.error) };
}

const reply = (c: Context, r: Reply) => c.json(r.body, r.status);

/** /api/saves：存档列表和创建、状态投影、提交回合、回合事件流（SSE，可按 Last-Event-ID 续收）、停止 */
export function saveRoutes(game: GameService, hub: TurnHub): Hono {
  const app = new Hono();

  app.onError((error, c) => {
    if (error instanceof SaveNotFoundError) return c.json({ error: "没有这个存档" }, 404);
    if (error instanceof SaveExistsError) return c.json({ error: "存档已存在" }, 409);
    throw error;
  });

  app.use("/:id/*", async (c, next) => {
    if (!isSaveId(c.req.param("id"))) return c.json({ error: "存档 id 不合法" }, 400);
    await next();
  });

  app.get("/", async (c) => c.json({ saves: await game.list() }));

  app.post("/", async (c) => {
    const parsed = await body(c, CreateSaveSchema);
    if (!parsed.ok) return c.json({ error: "存档信息不对", details: parsed.errors }, 400);
    return reply(c, await game.create(parsed.value));
  });

  app.get("/:id/state", async (c) => c.json(await game.state(c.req.param("id"))));

  app.post("/:id/turns", async (c) => {
    const parsed = await body(c, TurnRequestSchema);
    if (!parsed.ok) return c.json({ error: "提交的内容不对", details: parsed.errors }, 400);
    return reply(c, await game.submit(c.req.param("id"), parsed.value));
  });

  app.get("/:id/turns/:turnId/events", (c) => {
    const run = hub.get(c.req.param("id"), c.req.param("turnId"));
    if (!run) return c.json({ error: "没有这一轮，可能已经过期；刷新存档状态即可" }, 404);
    // EventSource 重连时带 Last-Event-ID；手动续收可以用 ?after=，含义相同：从这个 id 的下一个开始
    const last = Number.parseInt(c.req.header("last-event-id") ?? c.req.query("after") ?? "", 10);
    const from = Number.isInteger(last) && last >= 0 ? last + 1 : 0;
    return streamSSE(c, async (stream) => {
      let closed = false;
      stream.onAbort(() => {
        closed = true;
      });
      for await (const [id, event] of hub.follow(run, from, () => closed)) {
        await stream.writeSSE({ id: String(id), event: event.type, data: JSON.stringify(event) });
      }
    });
  });

  app.post("/:id/turns/:turnId/stop", (c) =>
    reply(c, game.stop(c.req.param("id"), c.req.param("turnId"))),
  );

  return app;
}
