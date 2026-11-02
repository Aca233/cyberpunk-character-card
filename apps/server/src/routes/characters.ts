import { boardModules, combos, cyberware, lifepath, npcs } from "@cp/content";
import {
  BoardSchema,
  BoardSlotSchema,
  CharacterCardSchema,
  type Clock,
  cyberwareRules,
  DraftRequestSchema,
  ImportRequestSchema,
  interpretModule,
  interpretTavernCard,
  type LlmClient,
  normalizeBoard,
  ProseRequestSchema,
  pruneAcquaintances,
  readTavernCard,
  START_CYBERWARE_POINTS,
  streamDraft,
  streamProse,
  tavernToCard,
} from "@cp/core";
import { type Context, Hono } from "hono";
import { stream } from "hono/streaming";
import { z } from "zod";
import type { CharacterStore } from "../characters";
import { AbortedError, UpstreamError } from "../providers/http";
import { randomHex } from "../random";

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
    // 旧识只认原作人物表和模块带出的人，对不上的去掉（用户定的，2026-10-30：15 个原作人物全部能选）
    const board = pruneAcquaintances(parsed.data.board, npcs);
    const fixed = normalizeBoard(board, { cyberware, combos });
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
      // 捏人第 3 步能选的原作人物：只给名片上公开的几项，秘密和身体不下发
      npcs: npcs.map((n) => ({
        id: n.id,
        name: n.name,
        ...(n.alias ? { alias: n.alias } : {}),
        role: n.role,
        look: n.look,
      })),
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
                // 稀有度给格子左边竖条染色（用户 2026-10-31："怎么没有稀有度颜色区分"）
                rarity: def.rarity,
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
    const id = `custom-${randomHex(4)}`;
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
  // 导入 Character Card V2：本作导出的原样还原，别处的交给辅助模型插主板、分属性；
  // 返回的卡还没保存，玩家在编辑页确认后再存
  app.post("/import", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "请求体不是合法的 JSON" }, 400);
    }
    const input = ImportRequestSchema.safeParse(body);
    if (!input.success) return c.json({ error: issuesOf(input.error).error }, 400);
    const read = readTavernCard(input.data.raw);
    if (!read.ok) return c.json({ error: read.error }, 400);
    const own = Boolean(read.card.own);
    try {
      const result =
        input.data.useModel && !own
          ? await interpretTavernCard(llm, read.card, boardModules, c.req.raw.signal)
          : { ok: true as const, ...tavernToCard(read.card) };
      if (!result.ok) return c.json({ error: result.error }, 502);
      const { card, warnings } = result;
      if (!card.board) return c.json({ card, warnings, own });
      // 联动和开局义体按内容表重算；义体表里对不上的义体整组去掉，回主板重选
      const fixed = normalizeBoard(card.board, { cyberware, combos });
      if (fixed.ok) return c.json({ card: { ...card, board: fixed.board }, warnings, own });
      const board = { ...card.board, cyberware: [] };
      const again = normalizeBoard(board, { cyberware, combos });
      return c.json({
        card: { ...card, board: again.ok ? again.board : board },
        warnings: [...warnings, `${fixed.error}；开局义体已清空`],
        own,
      });
    } catch (error) {
      if (error instanceof AbortedError) return c.json({ error: "已停止导入" }, 400);
      if (error instanceof UpstreamError) return c.json({ error: error.message }, 502);
      throw error;
    }
  });
  // 角色正文：一个区块交给辅助模型写，按行吐 JSON 事件（text / error / done）；不进回合日志
  app.post("/prose", async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: "请求体不是合法的 JSON" }, 400);
    }
    const input = ProseRequestSchema.safeParse(raw);
    if (!input.success) return c.json({ error: issuesOf(input.error).error }, 400);
    const signal = c.req.raw.signal;
    c.header("content-type", "application/x-ndjson; charset=utf-8");
    c.header("cache-control", "no-store");
    return stream(c, async (out) => {
      const send = (event: unknown) => out.write(`${JSON.stringify(event)}\n`);
      try {
        for await (const event of streamProse(llm, input.data, signal)) await send(event);
      } catch (error) {
        if (error instanceof AbortedError) return;
        const message = error instanceof UpstreamError ? error.message : "写正文时出错了，可以重试";
        if (!(error instanceof UpstreamError)) console.error(error);
        await send({ type: "error", message });
      }
    });
  });
  // 一键成稿（第三期，用户定的 2026-10-30）：一次写外貌、背景故事、性格、说话方式，顺带补旧识
  // "是什么事"；按行吐 JSON 事件，原文带【】标记，由前端收齐后拆开；不进回合日志
  app.post("/draft", async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: "请求体不是合法的 JSON" }, 400);
    }
    const input = DraftRequestSchema.safeParse(raw);
    if (!input.success) return c.json({ error: issuesOf(input.error).error }, 400);
    const signal = c.req.raw.signal;
    c.header("content-type", "application/x-ndjson; charset=utf-8");
    c.header("cache-control", "no-store");
    return stream(c, async (out) => {
      const send = (event: unknown) => out.write(`${JSON.stringify(event)}\n`);
      try {
        for await (const event of streamDraft(llm, input.data, signal)) await send(event);
      } catch (error) {
        if (error instanceof AbortedError) return;
        const message = error instanceof UpstreamError ? error.message : "成稿时出错了，可以重试";
        if (!(error instanceof UpstreamError)) console.error(error);
        await send({ type: "error", message });
      }
    });
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
