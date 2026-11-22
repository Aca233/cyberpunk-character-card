import type { Clock } from "@cp/core";
import { type Context, Hono } from "hono";
import { z } from "zod";
import {
  PRESET_MAX_BYTES,
  PresetPatchSchema,
  type PresetStore,
  type StoredPreset,
} from "../presets";

/**
 * 酒馆预设（用户定的）：导入、列表、启用、改开关、删除。
 * 网页先读出文件里的 JSON 再传上来，后端不读本机任意路径
 */

const ImportSchema = z.object({
  fileName: z.string().min(1).max(200),
  raw: z.unknown(),
});
const ActiveSchema = z.object({ id: z.string().nullable() });

/** 列表只回摘要和开关，不回条目全文：预设可能有几十万字 */
function summary(entry: StoredPreset, active: string | null) {
  const { preset } = entry;
  return {
    id: entry.id,
    name: preset.name,
    importedAt: entry.importedAt,
    warnings: entry.warnings,
    active: entry.id === active,
    sampling: preset.sampling,
    entries: preset.entries.map((e) => ({
      id: e.id,
      name: e.name,
      role: e.role,
      enabled: e.enabled,
      depth: e.depth,
      chars: e.content.length,
    })),
    regex: preset.regex.map((r) => ({ id: r.id, name: r.name, enabled: r.enabled })),
  };
}

async function readBody(c: Context): Promise<unknown> {
  return c.req.json().catch(() => undefined);
}

export function presetRoutes(store: PresetStore, clock: Clock): Hono {
  const routes = new Hono();

  routes.get("/", async (c) => {
    const active = await store.activeId();
    const list = await store.list();
    return c.json({ active, presets: list.map((p) => summary(p, active)) });
  });

  routes.post("/", async (c) => {
    const size = Number(c.req.header("content-length") ?? 0);
    if (size > PRESET_MAX_BYTES) return c.json({ error: "文件太大，不像是酒馆预设" }, 400);
    const body = ImportSchema.safeParse(await readBody(c));
    if (!body.success) return c.json({ error: "请求格式不对：要带 fileName 和 raw" }, 400);
    const result = await store.import(body.data.raw, body.data.fileName, clock.now());
    if (!result.ok) return c.json({ error: result.error }, 400);
    return c.json({ preset: summary(result.entry, await store.activeId()) }, 201);
  });

  routes.put("/-/active", async (c) => {
    const body = ActiveSchema.safeParse(await readBody(c));
    if (!body.success) return c.json({ error: "要带 id（不用预设时传 null）" }, 400);
    if (!(await store.setActive(body.data.id))) return c.json({ error: "没有这份预设" }, 404);
    return c.json({ active: body.data.id });
  });

  /** 展开一条时才取正文（用户定的：条目可展开查看、编辑）；列表照旧只回摘要 */
  routes.get("/:id/entries/:entry", async (c) => {
    const stored = await store.get(c.req.param("id"));
    if (!stored) return c.json({ error: "没有这份预设" }, 404);
    const entry = stored.preset.entries.find((e) => e.id === c.req.param("entry"));
    if (!entry) return c.json({ error: "没有这个条目" }, 404);
    return c.json({ id: entry.id, content: entry.content });
  });

  routes.patch("/:id", async (c) => {
    const body = PresetPatchSchema.safeParse(await readBody(c));
    if (!body.success)
      return c.json({ error: "只能改条目开关和正文、正则开关和要不要带采样参数" }, 400);
    const next = await store.update(c.req.param("id"), body.data);
    if (!next) return c.json({ error: "没有这份预设" }, 404);
    return c.json({ preset: summary(next, await store.activeId()) });
  });

  routes.delete("/:id", async (c) => {
    if (!(await store.remove(c.req.param("id")))) return c.json({ error: "没有这份预设" }, 404);
    return c.json({ ok: true });
  });

  return routes;
}
