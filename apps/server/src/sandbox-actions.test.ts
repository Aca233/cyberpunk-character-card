import "fake-indexeddb/auto";
import { type CheckRecord, serializeRecord, type TurnRecord } from "@cp/core";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { createLocalBackend, LOCAL_ORIGIN, type LocalBackend } from "./browser";
import { IdbSaveStore, openGameDb } from "./idb-store";

async function call(local: LocalBackend, path: string, body?: unknown) {
  const response = await local.fetch(
    new Request(`${LOCAL_ORIGIN}/api${path}`, {
      method: body === undefined ? "GET" : "POST",
      ...(body === undefined
        ? {}
        : {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
    }),
  );
  return { status: response.status, data: (await response.json()) as Record<string, unknown> };
}

async function setup() {
  const factory = new IDBFactory();
  const local = await createLocalBackend({ dbName: "sandbox-actions", factory });
  const created = await call(local, "/saves", { title: "沙盘操作验收", characterId: "sample-1" });
  expect(created.status).toBe(201);
  const id = String(created.data.id);
  const saves = new IdbSaveStore(await openGameDb("sandbox-actions", factory));
  return { local, id, saves };
}

const at = "2026-11-16T00:00:00.000Z";
const check = {
  intent: "打开门",
  attribute: "tech",
  tier: "street",
  dv: 8,
  bonuses: [],
  penalties: [],
  dvMods: [],
  success: "门打开",
  failure: "门没打开",
};

/** 注入废弃字段，验证它们不能重新开启检定或锁住其他行动。 */
async function seedAbandonedCheck(saves: IdbSaveStore, id: string) {
  const turn: TurnRecord = {
    kind: "turn",
    seq: 0,
    at,
    requestId: "seed-turn",
    baseVersion: 0,
    input: { text: "看看门" },
    text: "门闭着。",
    dice: [],
    commands: [],
    dropped: [],
    patches: [],
    check,
    choices: [{ text: "换条路线", gate: { attribute: "tech", value: 20 } }],
  };
  const roll: CheckRecord = {
    kind: "check",
    seq: 1,
    at,
    requestId: "seed-roll",
    checkId: "0",
    roll: { purpose: "check:tech", sides: 6, faces: [3, 4] },
  };
  await saves.appendLog(id, serializeRecord(turn));
  await saves.appendLog(id, serializeRecord(roll));
}

describe("沙盘自由行动入口", () => {
  it("拒绝 confirm、matrix 和空请求，不追加记录", async () => {
    const { local, id, saves } = await setup();
    for (const extra of [{ confirm: "0" }, { input: { text: "开门" }, matrix: 2 }, {}]) {
      const reply = await call(local, `/saves/${id}/turns`, {
        requestId: "free-action-001",
        baseVersion: 0,
        ...extra,
      });
      expect(reply.status).toBe(400);
    }
    expect((await saves.loadLog(id)).records).toEqual([]);
  });

  it("日志里的废弃检定不再生成确认卡或属性门槛，也不阻塞自由输入", async () => {
    const { local, id, saves } = await setup();
    await seedAbandonedCheck(saves, id);
    const state = await call(local, `/saves/${id}/state`);
    expect(state.status).toBe(200);
    expect(state.data.offers).toMatchObject({
      choices: [{ text: "换条路线", gate: null, checkId: null }],
      checks: [],
      rolled: null,
    });
    const reply = await call(local, `/saves/${id}/turns`, {
      requestId: "free-action-002",
      baseVersion: 2,
      input: { text: "离开这里" },
    });
    // 已走到模型配置检查；没有因废弃的骰子记录返回 409 或发起网络请求。
    expect(reply.status).toBe(503);
    expect(String(reply.data.error)).toContain("叙事模型");
    expect((await saves.loadLog(id)).records).toHaveLength(2);
  });

  it("界面操作和手机校验不受废弃骰子记录阻塞", async () => {
    const { local, id, saves } = await setup();
    await seedAbandonedCheck(saves, id);
    const phone = await call(local, `/saves/${id}/phone/chat`, {
      requestId: "free-phone-001",
      baseVersion: 2,
      contact: "unknown-channel",
      text: "你好",
    });
    expect(phone.status).toBe(409);
    expect(String(phone.data.error)).toContain("没有建档的加密频道");
    const action = await call(local, `/saves/${id}/actions`, {
      requestId: "free-habit-001",
      baseVersion: 2,
      action: { type: "habit", action: "add", text: "习惯先观察出口" },
    });
    expect(action.status).toBe(200);
    expect((await saves.loadLog(id)).records).toHaveLength(3);
  });

  it("拒绝重新启用属性点分配接口", async () => {
    const { local, id } = await setup();
    const action = await call(local, `/saves/${id}/actions`, {
      requestId: "free-points-001",
      baseVersion: 0,
      action: { type: "spendPoint", attribute: "body" },
    });
    expect(action.status).toBe(400);
  });
});
