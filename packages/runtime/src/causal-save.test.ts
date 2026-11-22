import "fake-indexeddb/auto";
import { gameContent } from "@cp/content";
import {
  economyRules,
  type LlmClient,
  type LlmRequest,
  newGameWorld,
  replay,
  type Snapshot,
} from "@cp/core";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalBackend, LOCAL_ORIGIN, type LocalBackend } from "./browser";
import { ProfileSchema } from "./config";
import { IdbSaveStore, openGameDb } from "./idb-store";
import { LlmRouter } from "./providers";

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

const attempted = {
  type: "breach",
  network: "保险柜内网",
  via: "接入点",
  gains: ["data"],
};
const impossibleReward = {
  type: "loot",
  amount: "lots",
  tier: "street",
  reason: "从未打开的保险柜中拿到钱",
  event: "impossible-vault-reward",
};
const independentReward = {
  type: "loot",
  amount: "some",
  tier: "street",
  reason: "朋友偿还此前的借款",
  event: "independent-repayment",
};
const original = "你打开保险柜拿走了钱，这时朋友也把此前的借款还给了你。";
const corrected = "保险柜依旧锁着，朋友把此前的借款还给了你。";

function mockTurnAndRewrite() {
  const requests: LlmRequest[] = [];
  const llm: LlmClient = {
    async *stream(request) {
      requests.push(request);
      const stage = request.responseFormat?.name;
      const rewrite = request.messages.some((m) => m.content.includes("【这一步：按账目改写】"));
      const value =
        stage === "judge"
          ? {
              read: "试图远程打开保险柜，同时收到一笔独立还款",
              ooc: false,
              ruling: {
                kind: "blocked",
                outcome: "保险柜物理隔离，无法远程接入",
                reason: "没有无线接口，也没有接上数据线",
                harm: "none",
              },
              buy: null,
              recall: [],
              foes: null,
            }
          : stage === "extract"
            ? {
                changes: [attempted, impossibleReward, independentReward],
                events: [
                  { id: "intrusion", requires: ["$action"], entries: ["changes[0]"] },
                  { id: "vault-reward", requires: ["intrusion"], entries: ["changes[1]"] },
                  { id: "repayment", requires: [], entries: ["changes[2]"] },
                ],
                choices: [],
                dropped: [],
                sceneMemory: { text: original, anchors: [], resolve: [] },
              }
            : rewrite
              ? corrected
              : original;
      yield { type: "text", text: typeof value === "string" ? value : JSON.stringify(value) };
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

afterEach(() => vi.restoreAllMocks());

describe("部分事件结算的当前版本存档与正文改写", () => {
  it("重开、导入及按账目改写都保留唯一成功收益，不复活失败事件或重复发钱", async () => {
    const factory = new IDBFactory();
    const options = { dbName: "causal-save", factory };
    const local = await createLocalBackend(options);
    const created = await call(local, "/saves", { title: "事件存档验收", characterId: "sample-1" });
    expect(created.status).toBe(201);
    const id = String(created.data.id);
    const saves = new IdbSaveStore(await openGameDb(options.dbName, factory));
    const initial: Snapshot = {
      nextSeq: 0,
      world: newGameWorld(await saves.readMeta(id), gameContent),
    };
    const startingEddies = economyRules.EconomyStateSchema.parse(
      initial.world.slices.economy,
    ).eddies;
    const requests = mockTurnAndRewrite();
    const started = await call(local, `/saves/${id}/turns`, {
      requestId: "partial-events-001",
      baseVersion: 0,
      input: { text: "我试着远程打开保险柜，等朋友把之前的借款还我。" },
      offscreen: "off",
    });
    expect(started.status).toBe(202);
    const run = local.hub.get(id, String(started.data.turnId));
    if (!run) throw new Error("缺少生成记录");
    for await (const [, event] of local.hub.follow(run, 0, () => false)) {
      if (event.type === "error") throw new Error(event.message);
    }
    expect(run.events.at(-1)?.type).toBe("done");
    const records = (await saves.loadLog(id)).records;
    expect(records).toHaveLength(1);
    const turn = records[0];
    if (turn?.kind !== "turn") throw new Error("缺少回合账目");
    expect(turn.commands).toEqual([independentReward]);
    expect(turn.draft).toBeUndefined();
    expect(turn.unsettled).toBeDefined();
    expect(turn.patches.length).toBeGreaterThan(0);
    const settled = replay(initial, records);
    const expectedMoney = {
      eddies: startingEddies + economyRules.LOOT_EDDIES.street.some,
    };
    expect(settled.slices.economy).toMatchObject({
      ...expectedMoney,
      settled: ["independent-repayment"],
    });
    expect(settled.slices.memory).toEqual(initial.world.slices.memory);
    expect(settled.slices.hacking).toEqual(initial.world.slices.hacking);

    const reopened = await createLocalBackend(options);
    const loaded = await call(reopened, `/saves/${id}/state`);
    expect(loaded.status).toBe(200);
    expect(loaded.data).toMatchObject({ version: 1, money: expectedMoney });
    expect((await saves.loadLog(id)).records).toEqual(records);

    const exported = await call(reopened, `/saves/${id}/export`);
    expect(exported.status).toBe(200);
    const importedFactory = new IDBFactory();
    const importedOptions = { dbName: "causal-import", factory: importedFactory };
    const destination = await createLocalBackend(importedOptions);
    const imported = await call(destination, "/saves/import", exported.data);
    expect(imported.status).toBe(201);
    const importedId = String(imported.data.id);
    const importedStore = new IdbSaveStore(
      await openGameDb(importedOptions.dbName, importedFactory),
    );
    expect((await importedStore.loadLog(importedId)).records).toEqual(records);
    expect((await call(destination, `/saves/${importedId}/state`)).data).toMatchObject({
      version: 1,
      money: expectedMoney,
    });

    const callsBeforeRewrite = requests.length;
    const rewrite = await call(destination, `/saves/${importedId}/rewrite`, { baseVersion: 1 });
    expect(rewrite.status).toBe(200);
    expect(requests).toHaveLength(callsBeforeRewrite + 1);
    expect(requests.at(-1)?.responseFormat).toBeUndefined();
    const rewritten = (await importedStore.loadLog(importedId)).records;
    expect(rewritten).toHaveLength(2);
    expect(rewritten.at(-1)).toMatchObject({
      kind: "turn",
      replaces: 0,
      text: corrected,
      commands: turn.commands,
      patches: turn.patches,
    });
    expect(rewritten.at(-1)).not.toHaveProperty("unsettled");
    expect(replay(initial, rewritten)).toEqual(settled);
    const reloaded = await createLocalBackend(importedOptions);
    expect((await call(reloaded, `/saves/${importedId}/state`)).data).toMatchObject({
      version: 2,
      money: expectedMoney,
    });
    const repeated = await call(reloaded, `/saves/${importedId}/rewrite`, { baseVersion: 2 });
    expect(repeated.status).toBe(409);
    expect(requests).toHaveLength(callsBeforeRewrite + 1);
    expect((await importedStore.loadLog(importedId)).records).toEqual(rewritten);
  });
});
