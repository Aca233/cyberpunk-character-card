import "fake-indexeddb/auto";
import { serializeRecord, type TurnRecord } from "@cp/core";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalBackend, LOCAL_ORIGIN, type LocalBackend } from "./browser";
import { IdbSaveStore, openGameDb } from "./idb-store";

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

async function setup() {
  const factory = new IDBFactory();
  const first = await createLocalBackend({ dbName: "save-integrity", factory });
  const second = await createLocalBackend({ dbName: "save-integrity", factory });
  const created = await call(first, "/saves", { title: "存档一致性验收", characterId: "sample-1" });
  expect(created.status).toBe(201);
  const id = String(created.data.id);
  const saves = new IdbSaveStore(await openGameDb("save-integrity", factory));
  return { first, second, id, saves };
}

const seedTurn: TurnRecord = {
  kind: "turn",
  seq: 0,
  at: "2026-11-17T00:00:00.000Z",
  requestId: "seed-turn",
  baseVersion: 0,
  input: { text: "观察街道" },
  text: "街上行人往来。",
  dice: [],
  commands: [],
  dropped: [],
  patches: [],
};

afterEach(() => vi.restoreAllMocks());

async function seedBeforeSnapshot(saves: IdbSaveStore, id: string) {
  for (let seq = 0; seq < 9; seq++) {
    await saves.appendLog(
      id,
      serializeRecord({ ...seedTurn, seq, baseVersion: seq, requestId: `seed-turn-${seq}` }),
    );
  }
}

describe("多个页面共享存档", () => {
  it("新输入遇到正在生成的回合，返回旧回合原始输入用于恢复重试或付款确认", async () => {
    const { first, id, saves } = await setup();
    const original = { text: "向武器商人购买这把枪", spendOk: true };
    const run = first.hub.start(id, "running-purchase", 0, original);
    const reply = await call(first, `/saves/${id}/turns`, {
      requestId: "new-unrelated-input",
      baseVersion: 0,
      input: { text: "离开商店，去见杰克" },
    });
    expect(reply.status).toBe(409);
    expect(reply.data).toMatchObject({ turnId: run.turnId, version: 0, input: original });
    expect(first.hub.running(id)).toBe(run);
    expect((await saves.loadLog(id)).records).toEqual([]);
  });

  it("同时提交界面操作时只接受一次，日志仍能读取且可以继续操作", async () => {
    const { first, second, id, saves } = await setup();
    const replies = await Promise.all(
      [first, second].map((local, index) =>
        call(local, `/saves/${id}/actions`, {
          requestId: `simultaneous-habit-${index}`,
          baseVersion: 0,
          action: { type: "habit", action: "add", text: `习惯先观察出口 ${index}` },
        }),
      ),
    );
    expect(replies.map((reply) => reply.status).sort()).toEqual([200, 409]);
    expect((await saves.loadLog(id)).records).toHaveLength(1);
    expect((await call(first, `/saves/${id}/state`)).data.version).toBe(1);
    const next = await call(second, `/saves/${id}/actions`, {
      requestId: "after-concurrent-habits",
      baseVersion: 1,
      action: { type: "habit", action: "add", text: "习惯记住商家的名字" },
    });
    expect(next.status).toBe(200);
    expect((await saves.loadLog(id)).records.map((record) => record.seq)).toEqual([0, 1]);
  });

  it("同时重新生成不会写出两个同序号的作废记录", async () => {
    const { first, second, id, saves } = await setup();
    await saves.appendLog(id, serializeRecord(seedTurn));
    const replies = await Promise.all(
      [first, second].map((local) => call(local, `/saves/${id}/regenerate`, { baseVersion: 1 })),
    );
    expect(replies.map((reply) => reply.status).sort()).toEqual([200, 409]);
    expect((await saves.loadLog(id)).records.map((record) => record.seq)).toEqual([0, 1]);
    expect((await call(first, `/saves/${id}/state`)).data.version).toBe(2);
  });

  it("两个页面同时重来时整段场景只撤销一次，恢复后能继续操作", async () => {
    const { first, second, id, saves } = await setup();
    await saves.appendLog(id, serializeRecord(seedTurn));
    await saves.appendLog(
      id,
      serializeRecord({
        ...seedTurn,
        seq: 1,
        baseVersion: 1,
        requestId: "fatal-turn",
        text: "你倒在了街边。",
        patches: [{ op: "replace", path: ["slices", "health", "condition"], value: "dead" }],
      }),
    );
    const replies = await Promise.all(
      [first, second].map((local) => call(local, `/saves/${id}/restart`, { baseVersion: 2 })),
    );
    expect(replies.map((reply) => reply.status).sort()).toEqual([200, 409]);
    expect((await saves.loadLog(id)).records.map((record) => record.seq)).toEqual([0, 1, 2, 3]);
    const state = await call(first, `/saves/${id}/state`);
    expect(state.status).toBe(200);
    expect(state.data).toMatchObject({ version: 4, death: null, restarts: 1 });
    const next = await call(second, `/saves/${id}/actions`, {
      requestId: "after-concurrent-restarts",
      baseVersion: 4,
      action: { type: "habit", action: "add", text: "习惯先观察出口" },
    });
    expect(next.status).toBe(200);
  });
});

describe("自动快照不影响已提交的日志", () => {
  it("快照写入失败时仍返回操作成功，重新读取保留已保存的修改", async () => {
    const { first, id, saves } = await setup();
    await seedBeforeSnapshot(saves, id);
    vi.spyOn(IdbSaveStore.prototype, "writeSnapshot").mockRejectedValueOnce(
      new Error("模拟快照空间不足"),
    );
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await call(first, `/saves/${id}/actions`, {
      requestId: "snapshot-failure-habit",
      baseVersion: 9,
      action: { type: "habit", action: "add", text: "习惯先观察出口" },
    });
    expect(result.status).toBe(200);
    expect((await saves.loadLog(id)).records).toHaveLength(10);
    const state = await call(first, `/saves/${id}/state`);
    expect(state.status).toBe(200);
    expect(state.data.character).toMatchObject({ habits: ["习惯先观察出口"] });
  });

  it("创建快照前另一页已提交新操作，快照仍标记其真正包含的日志版本", async () => {
    const { first, second, id, saves } = await setup();
    await seedBeforeSnapshot(saves, id);
    const originalAppend = IdbSaveStore.prototype.appendAt;
    vi.spyOn(IdbSaveStore.prototype, "appendAt").mockImplementation(async function (
      this: IdbSaveStore,
      saveId,
      seq,
      line,
    ) {
      await originalAppend.call(this, saveId, seq, line);
      if (seq === 9) {
        const next = await call(second, `/saves/${id}/actions`, {
          requestId: "before-snapshot-second",
          baseVersion: 10,
          action: { type: "habit", action: "add", text: "习惯记住商家的名字" },
        });
        expect(next.status).toBe(200);
      }
    });
    const result = await call(first, `/saves/${id}/actions`, {
      requestId: "before-snapshot-first",
      baseVersion: 9,
      action: { type: "habit", action: "add", text: "习惯先观察出口" },
    });
    expect(result.status).toBe(200);
    const state = await call(first, `/saves/${id}/state`);
    expect(state.status).toBe(200);
    expect(state.data.character).toMatchObject({
      habits: ["习惯先观察出口", "习惯记住商家的名字"],
    });
    expect((await saves.readSnapshots(id)).map((snapshot) => snapshot.nextSeq)).toEqual([11]);
  });
});
