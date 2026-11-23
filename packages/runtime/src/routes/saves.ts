import { ActionRequestSchema, PhoneChatRequestSchema, TurnRequestSchema } from "@cp/core";
import type { Context } from "hono";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { z } from "zod";
import {
  CreateSaveSchema,
  type GameService,
  RegenerateRequestSchema,
  type Reply,
  RestartRequestSchema,
  SaveExportSchema,
  UndoTurnRequestSchema,
} from "../game";
import { isSaveId, SaveExistsError, SaveNotFoundError } from "../ports";
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

/** /api/saves：存档列表和创建、状态投影、提交回合、界面操作、回合事件流、停止、上下文查看器 */
/** 剧透调试视图的接口：要带 x-cp-spoilers: 1（网页上打开「显示剧透」） */
const SPOILER_HEADER = "x-cp-spoilers";
const SPOILER_LOCKED = "这是剧透调试视图：先到设置的叙事偏好里打开「显示剧透」";

export function saveRoutes(game: GameService, hub: TurnHub): Hono {
  const locked = (c: Context) => c.req.header(SPOILER_HEADER) !== "1";
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

  // 完整导出和导入：整份存档（含剧透），只用来备份和换电脑
  app.post("/import", async (c) => {
    const parsed = await body(c, SaveExportSchema);
    if (!parsed.ok) {
      return c.json({ error: "不是本作完整导出的存档文件", details: parsed.errors }, 400);
    }
    return reply(c, await game.importSave(parsed.value));
  });

  app.get("/:id/export", async (c) => reply(c, await game.exportSave(c.req.param("id"))));

  app.get("/:id/state", async (c) => c.json(await game.state(c.req.param("id"))));

  app.delete("/:id/checkpoint", async (c) =>
    reply(c, await game.clearCheckpoint(c.req.param("id"))),
  );

  app.post("/:id/turns", async (c) => {
    const parsed = await body(c, TurnRequestSchema);
    if (!parsed.ok) return c.json({ error: "提交的内容不对", details: parsed.errors }, 400);
    return reply(c, await game.submit(c.req.param("id"), parsed.value));
  });

  app.post("/:id/actions", async (c) => {
    const parsed = await body(c, ActionRequestSchema);
    if (!parsed.ok) return c.json({ error: "提交的操作不对", details: parsed.errors }, 400);
    return reply(c, await game.action(c.req.param("id"), parsed.value));
  });

  app.post("/:id/phone/chat", async (c) => {
    const parsed = await body(c, PhoneChatRequestSchema);
    if (!parsed.ok) return c.json({ error: "提交的私信内容不对", details: parsed.errors }, 400);
    return reply(c, await game.phoneChat(c.req.param("id"), parsed.value));
  });

  app.post("/:id/restart", async (c) => {
    const parsed = await body(c, RestartRequestSchema);
    if (!parsed.ok) return c.json({ error: "提交的内容不对", details: parsed.errors }, 400);
    return reply(c, await game.restart(c.req.param("id"), parsed.value));
  });

  app.post("/:id/regenerate", async (c) => {
    const parsed = await body(c, RegenerateRequestSchema);
    if (!parsed.ok) return c.json({ error: "提交的内容不对", details: parsed.errors }, 400);
    return reply(c, await game.regenerate(c.req.param("id"), parsed.value));
  });

  app.post("/:id/rewrite", async (c) => {
    const parsed = await body(c, RegenerateRequestSchema);
    if (!parsed.ok) return c.json({ error: "提交的内容不对", details: parsed.errors }, 400);
    return reply(c, await game.rewrite(c.req.param("id"), parsed.value));
  });

  app.post("/:id/undo", async (c) => {
    const parsed = await body(c, UndoTurnRequestSchema);
    if (!parsed.ok) return c.json({ error: "提交的内容不对", details: parsed.errors }, 400);
    return reply(c, await game.undoTurn(c.req.param("id"), parsed.value));
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

  app.get("/:id/turns/:seq/context", async (c) => {
    if (locked(c)) return c.json({ error: SPOILER_LOCKED }, 403);
    const seq = Number(c.req.param("seq"));
    if (!Number.isInteger(seq) || seq < 0) return c.json({ error: "轮次序号不合法" }, 400);
    return reply(c, await game.context(c.req.param("id"), seq));
  });

  app.post("/:id/turns/:seq/eval-case", async (c) => {
    if (locked(c)) return c.json({ error: SPOILER_LOCKED }, 403);
    const seq = Number(c.req.param("seq"));
    if (!Number.isInteger(seq) || seq < 0) return c.json({ error: "轮次序号不合法" }, 400);
    return reply(c, await game.evalDraft(c.req.param("id"), seq));
  });

  app.post("/:id/turns/:turnId/stop", (c) =>
    reply(c, game.stop(c.req.param("id"), c.req.param("turnId"))),
  );

  return app;
}
