import { randomBytes } from "node:crypto";
import { boardModules, combos, cyberware, lifepath } from "@cp/content";
import {
  BoardSchema,
  BoardSlotSchema,
  CharacterCardSchema,
  type Clock,
  cyberwareRules,
  interpretModule,
  type LlmClient,
  normalizeBoard,
  START_CYBERWARE_POINTS,
} from "@cp/core";
import { type Context, Hono } from "hono";
import { z } from "zod";
import type { CharacterStore } from "../characters";
import { AbortedError, UpstreamError } from "../providers/http";

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
    // 开局义体的点数、人性消耗和联动按内容表重算，再校验一次预算
    const fixed = normalizeBoard(parsed.data.board, { cyberware, combos });
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

const InterpretSchema = z.object({
  slot: BoardSlotSchema,
  text: z.string().trim().min(4, "多写几句再交给模型解读").max(600, "设定最多 600 字"),
  board: BoardSchema.optional(),
});

/** 模块库里用过的标签：解读时让模型尽量沿用，联动才对得上 */
const KNOWN_TAGS = [...new Set(boardModules.flatMap((m) => m.tags))];

/** /api/characters：角色卡的列表、新建、修改、删除；示例角色只读 */
export function characterRoutes(store: CharacterStore, clock: Clock, llm: LlmClient): Hono {
  const app = new Hono();
  app.get("/", async (c) => c.json({ characters: await store.list() }));
  // 主板要用的表：模块库、联动、生命路径和创建时能装的义体；要放在 /:id 前面
  app.get("/board", (c) =>
    c.json({
      modules: boardModules,
      combos,
      lifepath,
      cyberware: cyberware.flatMap((def) => {
        const points = START_CYBERWARE_POINTS[def.rarity];
        return def.iconic || points === undefined
          ? []
          : [
              {
                id: def.id,
                name: def.name,
                slot: def.slot,
                slotLabel: cyberwareRules.SLOT_LABELS[def.slot],
                points,
                humanityCost: def.humanityCost,
                ability: def.ability,
              },
            ];
      }),
    }),
  );
  // 自写模块交给辅助模型解读；不进回合日志，结果由玩家确认后才插上
  app.post("/interpret", async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: "请求体不是合法的 JSON" }, 400);
    }
    const input = InterpretSchema.safeParse(raw);
    if (!input.success) return c.json({ error: issuesOf(input.error).error }, 400);
    const id = `custom-${randomBytes(4).toString("hex")}`;
    try {
      const result = await interpretModule(
        llm,
        { ...input.data, knownTags: KNOWN_TAGS },
        id,
        c.req.raw.signal,
      );
      return result.ok ? c.json(result.reading) : c.json({ error: result.error }, 502);
    } catch (error) {
      if (error instanceof AbortedError) return c.json({ error: "已停止解读" }, 400);
      if (error instanceof UpstreamError) return c.json({ error: error.message }, 502);
      throw error;
    }
  });
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
