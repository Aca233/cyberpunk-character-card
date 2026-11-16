import "fake-indexeddb/auto";
import { gameContent, gameData } from "@cp/content";
import {
  type BuyProposal,
  BuyProposalSchema,
  economyRules,
  inventoryRules,
  type LlmClient,
  newGameWorld,
  npcRules,
  purchaseQuote,
  registry,
  replay,
  type Snapshot,
  type TurnInput,
  type WorldState,
} from "@cp/core";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalBackend, LOCAL_ORIGIN, type LocalBackend } from "./browser";
import { ProfileSchema } from "./config";
import { IdbSaveStore, openGameDb } from "./idb-store";
import { LlmRouter } from "./providers";

const text = "按刚才的条件买下这把自由手枪。";
const normalBuy = BuyProposalSchema.parse({ item: "liberty", with: "wilson" });

async function call(local: LocalBackend, path: string, body?: unknown) {
  const response = await local.fetch(
    new Request(`${LOCAL_ORIGIN}/api${path}`, {
      method: body === undefined ? "GET" : "POST",
      ...(body === undefined
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    }),
  );
  return { status: response.status, data: (await response.json()) as Record<string, unknown> };
}

async function setup(eddies = 3000) {
  const factory = new IDBFactory();
  const local = await createLocalBackend({ dbName: "merchant-confirmation", factory });
  const created = await call(local, "/saves", { title: "交易确认验收", characterId: "sample-1" });
  expect(created.status).toBe(201);
  const id = String(created.data.id);
  const saves = new IdbSaveStore(await openGameDb("merchant-confirmation", factory));
  const base = newGameWorld(await saves.readMeta(id), gameContent);
  const vendor = npcRules.NpcSchema.parse({
    id: "private-seller",
    name: "私人物主",
    pronoun: "他",
    role: "店里的顾客",
    look: "旧夹克",
    voice: "话少",
    want: "出售自己的手枪",
    limit: "不赊账",
    affinity: 0,
    alive: true,
    met: true,
    location: "megabuilding-h10",
    lastSeenAt: base.time,
    memories: [],
    body: { gear: ["liberty"], cyberware: [] },
  });
  const people = npcRules.NpcStateSchema.parse(base.slices.npc);
  const world: WorldState = {
    ...base,
    slices: {
      ...base.slices,
      economy: { eddies, settled: [] },
      world: { ...(base.slices.world as object), location: "megabuilding-h10" },
      npc: { ...people, npcs: { ...people.npcs, [vendor.id]: vendor } },
    },
  };
  const initial: Snapshot = { nextSeq: 0, world };
  await saves.writeSnapshot(id, initial);
  return { local, id, saves, initial };
}

function mockStages(buys: readonly BuyProposal[], allowPurchase = false) {
  const requests: string[] = [];
  let judged = 0;
  const prose = "威尔逊确认收到 1600 欧元，把自由手枪交到你手中。";
  const llm: LlmClient = {
    async *stream(request) {
      const stage = request.responseFormat?.name ?? "narrate";
      requests.push(stage);
      let reply: string;
      if (stage === "judge") {
        const buy = buys[judged++];
        if (!buy) throw new Error("不应额外调用判断模型");
        reply = JSON.stringify({
          read: "按已接受条件购买",
          ooc: false,
          ruling: null,
          buy,
          recall: [],
        });
      } else if (allowPurchase && stage === "narrate") {
        reply = prose;
      } else if (allowPurchase && stage === "extract") {
        reply = JSON.stringify({
          changes: [
            { type: "world", activity: "talk" },
            {
              type: "trade",
              action: "buy",
              item: "liberty",
              with: "wilson",
              reason: "已确认购买并收到手枪",
            },
          ],
          choices: [],
          dropped: [],
          sceneMemory: { text: prose, anchors: [], resolve: [] },
        });
      } else throw new Error(`未经具体确认，不应开始 ${stage}`);
      yield { type: "text", text: reply };
      yield { type: "done", finishReason: "stop" };
    },
  };
  vi.spyOn(LlmRouter.prototype, "resolve").mockResolvedValue({
    ok: true,
    profile: ProfileSchema.parse({
      name: "mock",
      type: "openai",
      model: "mock",
      contextWindow: 128000,
    }),
    client: llm,
  });
  return requests;
}

async function submit(
  fixture: Awaited<ReturnType<typeof setup>>,
  requestId: string,
  input: TurnInput = { text },
  baseVersion = 0,
) {
  const started = await call(fixture.local, `/saves/${fixture.id}/turns`, {
    requestId,
    baseVersion,
    input,
    offscreen: "off",
  });
  expect(started.status).toBe(202);
  const run = fixture.local.hub.get(fixture.id, String(started.data.turnId));
  if (!run) throw new Error("缺少生成记录");
  for await (const [, event] of fixture.local.hub.follow(run, 0, () => false)) {
    if (event.type === "error") throw new Error(event.message);
  }
  return run.events.at(-1);
}

afterEach(() => vi.restoreAllMocks());

describe("服务器绑定具体交易的大额确认", () => {
  it("首次大额交易仅返回实际金额的确认事件，不写日志或扣款", async () => {
    const fixture = await setup();
    const requests = mockStages([normalBuy]);
    const quote = purchaseQuote(fixture.initial.world, gameData, normalBuy);
    expect(quote).toMatchObject({ ok: true, price: 1600 });
    expect(await submit(fixture, "first-confirm")).toMatchObject({
      type: "confirmSpend",
      price: 1600,
      eddies: 3000,
    });
    expect(requests).toEqual(["judge"]);
    expect((await fixture.saves.loadLog(fixture.id)).records).toEqual([]);
    const saved = (await fixture.saves.readSnapshots(fixture.id))[0];
    expect(saved?.world).toEqual(fixture.initial.world);
  });

  it.each([
    ["商品", BuyProposalSchema.parse({ item: "omaha", with: "wilson" }), 2500],
    ["卖方", BuyProposalSchema.parse({ item: "liberty", with: "private-seller" }), 1600],
  ] as const)("同一输入点确认后，判断换了%s仍必须再次确认", async (_what, changed, price) => {
    const fixture = await setup();
    const requests = mockStages([normalBuy, changed]);
    expect(await submit(fixture, "original-confirm")).toMatchObject({
      type: "confirmSpend",
      price: 1600,
    });
    expect(await submit(fixture, "changed-confirm", { text, spendOk: true })).toMatchObject({
      type: "confirmSpend",
      price,
    });
    expect(requests).toEqual(["judge", "judge"]);
    expect((await fixture.saves.loadLog(fixture.id)).records).toEqual([]);
  });

  it("同一商品金额改变后必须展示新金额，不能复用旧确认", async () => {
    const fixture = await setup(2000);
    const requests = mockStages([normalBuy, normalBuy]);
    const offer = (world: WorldState, id: string, price: number) => {
      const evidence = `威尔逊说：这把自由手枪现在收你 ${price} 欧元。`;
      const quoted = registry.applyCommands(
        world,
        [
          {
            type: "commerce.offer",
            id,
            seller: "wilson",
            kind: "item",
            action: "buy",
            target: "liberty",
            price,
            evidence,
          },
        ],
        { rng: { roll: () => 1 }, data: gameData, facts: { tradeNarrative: evidence } },
      );
      expect(quoted.results[0]?.result.ok).toBe(true);
      return quoted.world;
    };
    const original = offer(fixture.initial.world, "original-liberty-price", 1200);
    await fixture.saves.writeSnapshot(fixture.id, { nextSeq: 0, world: original });
    expect(await submit(fixture, "price-first-confirm")).toMatchObject({
      type: "confirmSpend",
      price: 1200,
    });
    // 测试夹具固定版本，仅重算真实报价，隔离金额绑定；实际报价落盘的版本变化另有测试。
    const revised = offer(original, "revised-liberty-price", 1400);
    await fixture.saves.writeSnapshot(fixture.id, { nextSeq: 0, world: revised });
    expect(await submit(fixture, "price-changed-confirm", { text, spendOk: true })).toMatchObject({
      type: "confirmSpend",
      price: 1400,
    });
    expect(requests).toEqual(["judge", "judge"]);
    expect((await fixture.saves.loadLog(fixture.id)).records).toEqual([]);
  });

  it("没有待确认记录时，单独传 spendOk 不能越过确认", async () => {
    const fixture = await setup();
    const requests = mockStages([normalBuy]);
    expect(await submit(fixture, "unsolicited-confirm", { text, spendOk: true })).toMatchObject({
      type: "confirmSpend",
      price: 1600,
    });
    expect(requests).toEqual(["judge"]);
    expect((await fixture.saves.loadLog(fixture.id)).records).toEqual([]);
  });

  it("确认绑定原输入，换了行动文本后相同商品也必须重新确认", async () => {
    const fixture = await setup();
    const requests = mockStages([normalBuy, normalBuy]);
    expect(await submit(fixture, "input-first-confirm")).toMatchObject({ type: "confirmSpend" });
    expect(
      await submit(fixture, "input-changed-confirm", {
        text: `${text}先看看附件。`,
        spendOk: true,
      }),
    ).toMatchObject({ type: "confirmSpend" });
    expect(requests).toEqual(["judge", "judge"]);
    expect((await fixture.saves.loadLog(fixture.id)).records).toEqual([]);
  });

  it("存档版本改变后旧确认不能沿用", async () => {
    const fixture = await setup();
    const requests = mockStages([normalBuy, normalBuy]);
    expect(await submit(fixture, "version-first-confirm")).toMatchObject({ type: "confirmSpend" });
    const action = await call(fixture.local, `/saves/${fixture.id}/actions`, {
      requestId: "intervening-action",
      baseVersion: 0,
      action: { type: "habit", action: "add", text: "买枪前先检查枪膛" },
    });
    expect(action.status).toBe(200);
    expect(await submit(fixture, "version-next-confirm", { text, spendOk: true }, 1)).toMatchObject(
      { type: "confirmSpend" },
    );
    expect(requests).toEqual(["judge", "judge"]);
    expect((await fixture.saves.loadLog(fixture.id)).records).toHaveLength(1);
  });

  it("真实相同确认后只扣一次款、交一件货，重发请求不会重买", async () => {
    const fixture = await setup();
    const requests = mockStages([normalBuy, normalBuy], true);
    expect(await submit(fixture, "purchase-first-confirm")).toMatchObject({
      type: "confirmSpend",
      price: 1600,
    });
    expect(await submit(fixture, "purchase-confirmed", { text, spendOk: true })).toMatchObject({
      type: "done",
      version: 1,
    });
    const records = (await fixture.saves.loadLog(fixture.id)).records;
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      kind: "turn",
      commands: expect.arrayContaining([
        expect.objectContaining({ type: "trade", item: "liberty" }),
      ]),
    });
    const after = replay(fixture.initial, records);
    expect(economyRules.EconomyStateSchema.parse(after.slices.economy).eddies).toBe(1400);
    const beforeInventory = inventoryRules.InventoryStateSchema.parse(
      fixture.initial.world.slices.inventory,
    );
    const afterInventory = inventoryRules.InventoryStateSchema.parse(after.slices.inventory);
    expect(afterInventory.backpack.liberty ?? 0).toBe((beforeInventory.backpack.liberty ?? 0) + 1);
    expect(afterInventory.shopStock.wilson?.sold.liberty).toBe(1);
    const repeated = await call(fixture.local, `/saves/${fixture.id}/turns`, {
      requestId: "purchase-confirmed",
      baseVersion: 0,
      input: { text, spendOk: true },
      offscreen: "off",
    });
    expect(repeated.status).toBe(200);
    expect(repeated.data).toMatchObject({ duplicate: true, version: 1 });
    expect((await fixture.saves.loadLog(fixture.id)).records).toEqual(records);
    expect(requests).toEqual(["judge", "judge", "narrate", "extract"]);
  });
});
