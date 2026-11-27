import type { Clock } from "@cp/core";
import { type Context, Hono } from "hono";
import { z } from "zod";
import {
  type StoredWorldbook,
  WORLDBOOK_MAX_BYTES,
  WorldbookPatchSchema,
  type WorldbookStore,
} from "../worldbooks";

/**
 * 酒馆世界书（SillyTavern World Info / Lorebook）：
 * 导入、新建、列表、查看/编辑条目、多本启用开关、导出标准 JSON、删除。
 */

const ImportSchema = z.union([
  z.object({
    fileName: z.string().min(1).max(200),
    raw: z.unknown(),
  }),
  z.object({
    createBlank: z.literal(true),
    name: z.string().trim().min(1).max(60),
  }),
]);

function summary(stored: StoredWorldbook) {
  const { worldbook } = stored;
  return {
    id: stored.id,
    name: worldbook.name,
    enabled: stored.enabled,
    importedAt: stored.importedAt,
    warnings: stored.warnings,
    scanDepth: worldbook.scanDepth,
    recursiveScanning: worldbook.recursiveScanning,
    entries: worldbook.entries.map((e) => ({
      id: e.id,
      name: e.name,
      enabled: e.enabled,
      constant: e.constant,
      keys: e.keys,
      secondaryKeys: e.secondaryKeys,
      selective: e.selective,
      selectiveLogic: e.selectiveLogic,
      caseSensitive: e.caseSensitive,
      matchWholeWords: e.matchWholeWords,
      order: e.order,
      position: e.position,
      depth: e.depth,
      role: e.role,
      scanDepth: e.scanDepth,
      chars: e.content.length,
    })),
  };
}

async function readBody(c: Context): Promise<unknown> {
  return c.req.json().catch(() => undefined);
}

export function worldbookRoutes(store: WorldbookStore, clock: Clock): Hono {
  const routes = new Hono();

  routes.get("/", async (c) => {
    const list = await store.list();
    return c.json({ worldbooks: list.map(summary) });
  });

  routes.post("/", async (c) => {
    const size = Number(c.req.header("content-length") ?? 0);
    if (size > WORLDBOOK_MAX_BYTES) return c.json({ error: "文件太大，不像是酒馆世界书" }, 400);
    const body = ImportSchema.safeParse(await readBody(c));
    if (!body.success) return c.json({ error: "请求格式不对：请上传世界书 JSON 或填写名称" }, 400);
    if ("createBlank" in body.data) {
      const created = await store.createBlank(body.data.name, clock.now());
      return c.json({ worldbook: summary(created) }, 201);
    }
    const result = await store.import(body.data.raw, body.data.fileName, clock.now());
    if (!result.ok) return c.json({ error: result.error }, 400);
    return c.json({ worldbook: summary(result.entry) }, 201);
  });

  routes.get("/:id/export", async (c) => {
    const exported = await store.exportJson(c.req.param("id"));
    if (!exported) return c.json({ error: "没有这份世界书" }, 404);
    return c.json({ fileName: `${exported.name}.json`, data: exported.data });
  });

  routes.get("/:id/entries/:entry", async (c) => {
    const stored = await store.get(c.req.param("id"));
    if (!stored) return c.json({ error: "没有这份世界书" }, 404);
    const entry = stored.worldbook.entries.find((e) => e.id === c.req.param("entry"));
    if (!entry) return c.json({ error: "没有这个条目" }, 404);
    return c.json({ entry });
  });

  routes.patch("/:id", async (c) => {
    const body = WorldbookPatchSchema.safeParse(await readBody(c));
    if (!body.success) return c.json({ error: "世界书修改字段不合法" }, 400);
    const next = await store.update(c.req.param("id"), body.data);
    if (!next) return c.json({ error: "没有这份世界书" }, 404);
    return c.json({ worldbook: summary(next) });
  });

  routes.delete("/:id", async (c) => {
    if (!(await store.remove(c.req.param("id")))) return c.json({ error: "没有这份世界书" }, 404);
    return c.json({ ok: true });
  });

  return routes;
}
