import { boardModules, cyberware, items, loadouts, npcs, quickhacks, vehicles } from "@cp/content";
import {
  BoardSchema,
  BoardSlotSchema,
  CharacterCardSchema,
  type Clock,
  cyberwareRules,
  DraftRequestSchema,
  interpretModule,
  type LlmClient,
  normalizeBoard,
  ProseRequestSchema,
  pruneAcquaintances,
  START_CYBERWARE_RARITIES,
  streamDraft,
  streamProse,
  workshopEntityPackId,
} from "@cp/core";
import { type Context, Hono } from "hono";
import { stream } from "hono/streaming";
import { z } from "zod";
import type { CharacterStore } from "../characters";
import { AbortedError, UpstreamError } from "../providers/http";
import { randomHex } from "../random";
import type { WorkshopStore } from "../workshop";
import { workshopRuntime } from "../workshop-content";

async function readCard(c: Context, workshop?: WorkshopStore) {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return { ok: false as const, error: "请求体不是合法的 JSON" };
  }
  const parsed = CharacterCardSchema.safeParse(raw);
  if (parsed.success) {
    if (!parsed.data.board) return { ok: true as const, card: parsed.data };
    const packs = ((await workshop?.list()) ?? []).map((entry) => entry.pack);
    const runtime = workshopRuntime(packs);
    // 按内容表重算开局义体快照并校验部位容量，再检查角色卡结构。
    // 旧识只认原作人物表和模块带出的人，对不上的去掉（用户定的，2026-10-30：15 个原作人物全部能选）
    const board = pruneAcquaintances(parsed.data.board, runtime.content.npcs ?? npcs);
    const fixed = normalizeBoard(board, { cyberware: runtime.content.cyberware ?? cyberware });
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

/** 模块库里用过的标签：解读时让模型尽量沿用，方便分类筛选与检定判断 */
const KNOWN_TAGS = [...new Set(boardModules.flatMap((m) => m.tags))];

const START_WEAPON_RARITIES: ReadonlySet<string> = new Set([
  "common",
  "uncommon",
  "rare",
  "epic",
  "legendary",
]);

/** /api/characters：角色卡的列表、新建、修改、删除；示例角色只读 */
export function characterRoutes(
  store: CharacterStore,
  clock: Clock,
  llm: LlmClient,
  workshop?: WorkshopStore,
): Hono {
  const app = new Hono();
  app.get("/", async (c) => c.json({ characters: await store.list() }));
  // 主板要用的表：模块库、创建时能装的义体与开局武器/载具；要放在 /:id 前面
  app.get("/board", async (c) => {
    const packs = ((await workshop?.list()) ?? [])
      .filter((entry) => entry.enabled)
      .map((entry) => entry.pack);
    const runtime = workshopRuntime(packs);
    const allItems = runtime.content.items ?? items;
    const allCyberware = runtime.content.cyberware ?? cyberware;
    const allNpcs = runtime.content.npcs ?? npcs;
    const customPackId = workshopEntityPackId;
    return c.json({
      modules: [...boardModules, ...runtime.modules],
      acquaintances: runtime.acquaintances,
      // 捏人能选的原作人物：只给名片上公开的几项，秘密和身体不下发
      npcs: allNpcs.map((n) => ({
        id: n.id,
        name: n.name,
        ...(n.alias ? { alias: n.alias } : {}),
        role: n.role,
        look: n.look,
        ...(customPackId(n.id) ? { packId: customPackId(n.id) } : {}),
      })),
      cyberware: allCyberware.flatMap((def) =>
        def.iconic || !START_CYBERWARE_RARITIES.has(def.rarity)
          ? []
          : [
              {
                id: def.id,
                name: def.name,
                slot: def.slot,
                slotLabel: cyberwareRules.SLOT_LABELS[def.slot],
                rarity: def.rarity,
                humanityCost: def.humanityCost,
                ...(def.deckProfile !== undefined ? { deckProfile: def.deckProfile } : {}),
                ...(def.deckTraits !== undefined
                  ? {
                      deckTraits: def.deckTraits.map((t) => cyberwareRules.DECK_TRAIT_LABELS[t]),
                    }
                  : {}),
                ...(def.armor ? { armor: true } : {}),
                ...(def.accelerator ? { accelerator: true } : {}),
                ...(def.checks.length > 0 ? { checks: def.checks } : {}),
                ...(Object.keys(def.attributes).length > 0 ? { attributes: def.attributes } : {}),
                ability: def.ability,
                ...(customPackId(def.id) ? { custom: true, packId: customPackId(def.id) } : {}),
              },
            ],
      ),
      weapons: allItems.flatMap((def) => {
        if (
          def.kind !== "weapon" ||
          def.iconic ||
          def.rarity === undefined ||
          !START_WEAPON_RARITIES.has(def.rarity)
        ) {
          return [];
        }
        return [
          {
            id: def.id,
            name: def.name,
            ...(def.category ? { category: def.category } : {}),
            rarity: def.rarity,
            ability: def.ability,
          },
        ];
      }),
      vehicles: vehicles.map((v) => ({
        id: v.id,
        name: v.name,
        maker: v.maker,
        class: v.class,
        seats: v.seats,
        ...(v.note ? { note: v.note } : {}),
      })),
      // 出身自带的开局行装（和建档时 pickLoadouts 用的同一张表），建卡界面据此透明展示家底和自带义体
      loadouts,
      names: Object.fromEntries([
        ...allItems.map((i) => [i.id, i.name] as const),
        ...vehicles.map((v) => [v.id, v.name] as const),
        ...quickhacks.map((q) => [q.id, q.name] as const),
        ...allCyberware.map((c) => [c.id, c.name] as const),
      ]),
    });
  });
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
    const read = await readCard(c, workshop);
    if (!read.ok) return c.json({ error: read.error }, 400);
    return c.json({ character: await store.save(undefined, read.card, clock.now()) }, 201);
  });
  app.put("/:id", async (c) => {
    const id = c.req.param("id");
    const existing = await store.get(id);
    if (!existing) return c.json({ error: "没有这个角色" }, 404);
    if (existing.sample) return c.json({ error: "示例角色不能改，可以复制一份再改" }, 409);
    const read = await readCard(c, workshop);
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
