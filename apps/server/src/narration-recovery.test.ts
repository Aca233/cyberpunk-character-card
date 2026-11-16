import "fake-indexeddb/auto";
import { gameContent } from "@cp/content";
import {
  type LlmClient,
  memoryRules,
  newGameWorld,
  replay,
  type Snapshot,
  serializeRecord,
  type TurnRecord,
  type WorldState,
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
async function setup() {
  const factory = new IDBFactory();
  const local = await createLocalBackend({ dbName: "recovery", factory });
  const created = await call(local, "/saves", { title: "恢复验收", characterId: "sample-1" });
  expect(created.status).toBe(201);
  const id = String(created.data.id);
  const saves = new IdbSaveStore(await openGameDb("recovery", factory));
  return { local, id, saves };
}
const prose = "门后响起一阵脚步，柜台上的蓝色钥匙还在原处。";
afterEach(() => vi.restoreAllMocks());

describe("未结算正文的真实存档流程", () => {
  it.each(["narration-length", "extract-disconnect"])(
    "%s 保存草稿并拒绝误用按账目改写，允许重新生成",
    async (mode) => {
      const { local, id, saves } = await setup();
      const requests: string[] = [];
      const llm: LlmClient = {
        async *stream(request) {
          const stage = request.responseFormat?.name ?? "narrate";
          requests.push(stage);
          if (stage === "extract") throw new Error("模拟辅助断线");
          yield {
            type: "text",
            text:
              stage === "judge"
                ? JSON.stringify({
                    read: "观察柜台",
                    ooc: false,
                    ruling: null,
                    buy: null,
                    recall: [],
                  })
                : prose,
          };
          yield {
            type: "done",
            finishReason: stage === "narrate" && mode === "narration-length" ? "length" : "stop",
          };
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
      const initial: Snapshot = {
        nextSeq: 0,
        world: newGameWorld(await saves.readMeta(id), gameContent),
      };
      const started = await call(local, `/saves/${id}/turns`, {
        requestId: "draft-stream-001",
        baseVersion: 0,
        input: { text: "观察柜台" },
      });
      expect(started.status).toBe(202);
      const run = local.hub.get(id, String(started.data.turnId));
      if (!run) throw new Error("缺少生成记录");
      for await (const [, event] of local.hub.follow(run, 0, () => false)) {
        if (event.type === "error") throw new Error(event.message);
      }
      expect(run.events.at(-1)?.type).toBe("done");
      const saved = (await saves.loadLog(id)).records;
      expect(saved).toHaveLength(1);
      expect(saved[0]).toMatchObject({
        kind: "turn",
        text: prose,
        draft: true,
        patches: [],
        commands: [],
      });
      expect(replay(initial, saved)).toEqual(initial.world);
      const before = requests.length;
      const rewrite = await call(local, `/saves/${id}/rewrite`, { baseVersion: 1 });
      expect(rewrite.status).toBe(409);
      expect(String(rewrite.data.error)).toContain("重新生成");
      expect(requests).toHaveLength(before);
      expect((await saves.loadLog(id)).records).toHaveLength(1);
      const regenerate = await call(local, `/saves/${id}/regenerate`, { baseVersion: 1 });
      expect(regenerate.status).toBe(200);
      const reset = (await saves.loadLog(id)).records;
      expect(reset.at(-1)).toMatchObject({ kind: "void", target: 0, reason: "regenerate" });
      expect(replay(initial, reset)).toEqual(initial.world);
    },
  );

  it("记忆面板编辑通过服务器注入真实截止序号，旧错误停止检索且不丢日志", async () => {
    const { local, id, saves } = await setup();
    const initial: Snapshot = {
      nextSeq: 0,
      world: newGameWorld(await saves.readMeta(id), gameContent),
    };
    const wrong = "你已经从诊所买到了药。";
    const corrected = "你只是计划去诊所买药，目前还没有出发。";
    const memory = memoryRules.MemoryStateSchema.parse({
      scenes: [
        {
          scene: 0,
          title: "诊所",
          text: wrong,
          people: [],
          place: null,
          importance: "normal",
          keywords: ["诊所", "药"],
          at: initial.world.time,
        },
      ],
      anchors: {
        medicine: {
          id: "medicine",
          kind: "fact",
          text: wrong,
          people: [],
          keywords: ["药"],
          evidence: { source: "narrative", quote: wrong },
          scene: 0,
          place: null,
          at: initial.world.time,
          resolution: null,
        },
      },
    });
    const turn: TurnRecord = {
      kind: "turn",
      seq: 0,
      at: "2026-11-16T00:00:00Z",
      requestId: "seed-memory",
      baseVersion: 0,
      input: { text: "我打算去买药" },
      dice: [],
      commands: [],
      dropped: [],
      text: wrong,
      scene: 0,
      patches: [{ op: "replace", path: ["slices", "memory"], value: memory }],
    };
    await saves.appendLog(id, serializeRecord(turn));
    const edit = await call(local, `/saves/${id}/actions`, {
      requestId: "edit-memory-001",
      baseVersion: 1,
      action: {
        type: "editMemory",
        what: "scene",
        action: "edit",
        scene: 0,
        before: wrong,
        text: corrected,
      },
    });
    expect(edit.status).toBe(200);
    const records = (await saves.loadLog(id)).records;
    expect(records).toHaveLength(2);
    expect(records[0]).toEqual(turn);
    const world: WorldState = replay(initial, records);
    const after = memoryRules.MemoryStateSchema.parse(world.slices.memory);
    expect(after.corrections["0"]?.through).toBe(0);
    expect(after.anchors).toEqual({});
    expect(after.scenes[0]?.text).toBe(corrected);
    expect(memoryRules.memoryRecords(world, records).some((r) => r.kind === "turn")).toBe(false);
  });
});
