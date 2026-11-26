import type { Clock, LlmClient } from "@cp/core";
import {
  generateWorkshopPack,
  type InstalledWorkshopPack,
  WorkshopGenerateRequestSchema,
  type WorkshopPack,
  WorkshopPackSchema,
  workshopPackIssues,
} from "@cp/core";
import { Hono } from "hono";
import { z } from "zod";
import { AbortedError, UpstreamError } from "../providers/http";
import type { WorkshopStore } from "../workshop";
import { workshopCatalog } from "../workshop-content";

const UpdateSchema = z.strictObject({ enabled: z.boolean() });

function packSummary(pack: WorkshopPack) {
  return {
    characters: pack.characters.length,
    modules: pack.modules.length,
    npcs: pack.npcs.length,
    items: pack.items.length,
    weapons: pack.items.filter((item) => item.kind === "weapon").length,
    cyberware: pack.cyberware.length,
    braindances: pack.braindances.length,
    chipContents: pack.chipContents.length,
    listings: pack.shopListings.length + pack.ripperdocListings.length,
  };
}

function validatePack(
  pack: WorkshopPack,
  installed: readonly InstalledWorkshopPack[],
  replaceId?: string,
): string[] {
  const issues = workshopPackIssues(pack, workshopCatalog);
  if (replaceId !== pack.id && installed.some((entry) => entry.pack.id === pack.id)) {
    issues.unshift(`内容包 id「${pack.id}」已安装；请先卸载旧包或修改包 id`);
  }
  return issues;
}

/** 本地玩家内容包的列表、AI 生成、校验、安装、原地更新、启停和卸载。 */
export function workshopRoutes(store: WorkshopStore, clock: Clock, llm?: LlmClient): Hono {
  const app = new Hono();
  app.get("/", async (c) => c.json({ packages: await store.list() }));
  app.post("/generate", async (c) => {
    if (!llm) {
      return c.json({ error: "当前环境未配置 AI 模型服务" }, 503);
    }
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: "请求体不是合法的 JSON" }, 400);
    }
    const parsed = WorkshopGenerateRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? "生成参数不合法" }, 400);
    }
    try {
      const result = await generateWorkshopPack(llm, parsed.data, c.req.raw.signal);
      if (!result.ok) {
        return c.json(
          { error: result.error, blocked: Boolean(result.blocked) },
          result.blocked ? 422 : 400,
        );
      }
      const issues = workshopPackIssues(result.pack, workshopCatalog);
      return c.json({ pack: result.pack, issues, summary: packSummary(result.pack) });
    } catch (error) {
      if (error instanceof AbortedError) {
        return c.json({ error: "已取消生成" }, 408);
      }
      if (error instanceof UpstreamError) {
        return c.json({ error: error.message }, 502);
      }
      return c.json({ error: error instanceof Error ? error.message : "AI 生成内容包失败" }, 500);
    }
  });
  app.post("/validate", async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: "内容包不是合法的 JSON" }, 400);
    }
    const parsed = WorkshopPackSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        {
          valid: false,
          issues: parsed.error.issues.map((issue) => `${issue.path.join(".")}：${issue.message}`),
        },
        200,
      );
    }
    const replaceId = c.req.query("replaceId") || undefined;
    const issues = validatePack(parsed.data, await store.list(), replaceId);
    return c.json({ valid: issues.length === 0, issues, summary: packSummary(parsed.data) });
  });
  app.post("/", async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: "内容包不是合法的 JSON" }, 400);
    }
    const parsed = WorkshopPackSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        {
          error: "内容包结构不合格",
          details: parsed.error.issues.map((issue) => `${issue.path.join(".")}：${issue.message}`),
        },
        400,
      );
    }
    const overwrite = c.req.query("overwrite") === "1";
    const list = await store.list();
    const exists = list.some((entry) => entry.pack.id === parsed.data.id);
    const issues = validatePack(parsed.data, list, overwrite ? parsed.data.id : undefined);
    if (issues.length > 0) return c.json({ error: "内容包引用校验失败", details: issues }, 400);
    try {
      if (overwrite && exists) {
        const updated = await store.replace(parsed.data.id, parsed.data, clock.now());
        if (!updated) return c.json({ error: "没有这个内容包" }, 404);
        return c.json({ package: updated }, 200);
      }
      const installed = await store.install(parsed.data, clock.now());
      return c.json({ package: installed }, 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "内容包安装失败" }, 409);
    }
  });
  app.put("/:id", async (c) => {
    const id = c.req.param("id");
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: "内容包不是合法的 JSON" }, 400);
    }
    const parsed = WorkshopPackSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        {
          error: "内容包结构不合格",
          details: parsed.error.issues.map((issue) => `${issue.path.join(".")}：${issue.message}`),
        },
        400,
      );
    }
    if (parsed.data.id !== id) {
      return c.json({ error: "更新已安装内容包时不能修改包 id" }, 400);
    }
    const issues = validatePack(parsed.data, await store.list(), id);
    if (issues.length > 0) return c.json({ error: "内容包引用校验失败", details: issues }, 400);
    try {
      const updated = await store.replace(id, parsed.data, clock.now());
      return updated ? c.json({ package: updated }) : c.json({ error: "没有这个内容包" }, 404);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "内容包更新失败" }, 400);
    }
  });
  app.patch("/:id", async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: "请求不是合法的 JSON" }, 400);
    }
    const parsed = UpdateSchema.safeParse(raw);
    if (!parsed.success) return c.json({ error: "启用状态不合法" }, 400);
    let updated: InstalledWorkshopPack | undefined;
    try {
      updated = await store.setEnabled(c.req.param("id"), parsed.data.enabled);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "更新失败" }, 400);
    }
    return updated ? c.json({ package: updated }) : c.json({ error: "没有这个内容包" }, 404);
  });
  app.delete("/:id", async (c) => {
    try {
      const removed = await store.remove(c.req.param("id"));
      return removed ? c.json({ ok: true }) : c.json({ error: "没有这个内容包" }, 404);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "卸载失败" }, 400);
    }
  });
  return app;
}
