import { cyberware } from "@cp/content";
import { CharacterCardSchema, type Clock, normalizeStartCyberware } from "@cp/core";
import { type Context, Hono } from "hono";
import type { z } from "zod";
import type { CharacterStore } from "../characters";

async function readCard(c: Context) {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return { ok: false as const, error: "请求体不是合法的 JSON" };
  }
  const parsed = CharacterCardSchema.safeParse(raw);
  if (parsed.success) {
    if (!parsed.data.board) return { ok: true as const, card: parsed.data };
    // 开局义体的点数和人性消耗按义体表重算，再校验一次预算
    const fixed = normalizeStartCyberware(parsed.data.board, cyberware);
    if (!fixed.ok) return { ok: false as const, error: fixed.error };
    return readCardAgain({ ...parsed.data, board: fixed.board });
  }
  return issuesOf(parsed.error);
}

function readCardAgain(raw: unknown) {
  const parsed = CharacterCardSchema.safeParse(raw);
  return parsed.success ? { ok: true as const, card: parsed.data } : issuesOf(parsed.error);
}

function issuesOf(error: z.ZodError) {
  return {
    ok: false as const,
    error: error.issues
      .map((i) => (i.path.length > 0 ? `${i.path.join(".")}：${i.message}` : i.message))
      .join("；"),
  };
}

/** /api/characters：角色卡的列表、新建、修改、删除；示例角色只读 */
export function characterRoutes(store: CharacterStore, clock: Clock): Hono {
  const app = new Hono();
  app.get("/", async (c) => c.json({ characters: await store.list() }));
  app.get("/:id", async (c) => {
    const entry = await store.get(c.req.param("id"));
    return entry ? c.json({ character: entry }) : c.json({ error: "没有这个角色" }, 404);
  });
  app.post("/", async (c) => {
    const read = await readCard(c);
    if (!read.ok) return c.json({ error: read.error }, 400);
    return c.json({ character: await store.save(undefined, read.card, clock.now()) }, 201);
  });
  app.put("/:id", async (c) => {
    const id = c.req.param("id");
    const existing = await store.get(id);
    if (!existing) return c.json({ error: "没有这个角色" }, 404);
    if (existing.sample) return c.json({ error: "示例角色不能改，可以复制一份再改" }, 409);
    const read = await readCard(c);
    if (!read.ok) return c.json({ error: read.error }, 400);
    return c.json({ character: await store.save(id, read.card, clock.now()) });
  });
  app.delete("/:id", async (c) => {
    const id = c.req.param("id");
    const existing = await store.get(id);
    if (existing?.sample) return c.json({ error: "示例角色不能删" }, 409);
    return (await store.remove(id)) ? c.json({ ok: true }) : c.json({ error: "没有这个角色" }, 404);
  });
  return app;
}
