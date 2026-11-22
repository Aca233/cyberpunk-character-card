import type { Clock } from "@cp/core";
import {
  type InstalledWorkshopPack,
  type WorkshopPack,
  WorkshopPackSchema,
  workshopPackIssues,
} from "@cp/core";
import { Hono } from "hono";
import { z } from "zod";
import type { WorkshopStore } from "../workshop";
import { workshopCatalog } from "../workshop-content";

const UpdateSchema = z.strictObject({ enabled: z.boolean() });

function packSummary(pack: WorkshopPack) {
  return {
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

function validatePack(pack: WorkshopPack, installed: readonly InstalledWorkshopPack[]): string[] {
  const issues = workshopPackIssues(pack, workshopCatalog);
  if (installed.some((entry) => entry.pack.id === pack.id)) {
    issues.unshift(`内容包 id「${pack.id}」已安装；请先卸载旧包或修改包 id`);
  }
  return issues;
}

/** 本地玩家内容包的列表、校验、安装、启停和卸载。 */
export function workshopRoutes(store: WorkshopStore, clock: Clock): Hono {
  const app = new Hono();
  app.get("/", async (c) => c.json({ packages: await store.list() }));
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
    const issues = validatePack(parsed.data, await store.list());
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
    const issues = validatePack(parsed.data, await store.list());
    if (issues.length > 0) return c.json({ error: "内容包引用校验失败", details: issues }, 400);
    try {
      const installed = await store.install(parsed.data, clock.now());
      return c.json({ package: installed }, 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "内容包安装失败" }, 409);
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
