import { describe, expect, it } from "vitest";
import { newGameWorld } from "../game";
import type { LlmClient, LlmRequest } from "../kernel/ports";
import { type LogRecord, replay, type TurnRecord } from "../kernel/turnlog";
import { TurnInputSchema } from "../schemas/turn";
import { CityStateSchema } from "../systems/city";
import { MemoryStateSchema } from "../systems/memory";
import { ThreadsStateSchema } from "../systems/threads";
import { memoryPool } from "./retrieve";
import { NarratorAbortedError, type NarratorTurn, runNarratorTurn } from "./turn";

const narrative =
  "诊所的百叶窗已经放下，药柜上的蓝色封条没有动过。你把明早取药的时间写进终端，准备离开。走廊的灯在身后熄灭，这一晚没有人取走药品，也没有人替你向诊所付款。";
const input = "明天上午九点回来取药，现在先离开诊所。";
const anchor = {
  id: "clinic-medicine",
  kind: "plan",
  text: "你打算翌日上午九点回诊所取药，尚未取药。",
  people: [],
  keywords: ["诊所", "取药"],
  evidence: { source: "input", quote: "明天上午九点回来取药" },
};
const summary = {
  title: "诊所的取药安排",
  text: "你在诊所确认了药品仍留在柜中，决定翌日上午九点回来取药，随后离开。药柜上的蓝色封条保持完整，百叶窗已经放下，走廊的灯也已熄灭。这一晚尚未完成取药，也没有发生付款；返回诊所和取药仍是待实行的计划，不能当成已经拿到药品。",
  people: [],
  importance: "normal",
  keywords: ["诊所", "取药"],
};
const working = {
  text: "你检查了诊所药柜，打算明日上午九点回来取药；尚未付款或取药。",
  anchors: [anchor],
  resolve: [],
};

async function run(
  world = newGameWorld({ startTime: 1000 }),
  options: {
    extract?: unknown;
    summary?: unknown;
    offscreen?: unknown;
    enabled?: boolean;
    records?: LogRecord[];
    ooc?: boolean;
    failStage?: "offscreen" | "summary";
    cancel?: boolean;
  } = {},
) {
  const requests: LlmRequest[] = [];
  const signal = { aborted: false, addEventListener() {} };
  const llm: LlmClient = {
    async *stream(request) {
      requests.push(request);
      const stage = request.responseFormat?.name;
      if (stage === options.failStage && options.failStage !== undefined) {
        yield { type: "text", text: '{"partial":' };
        signal.aborted = options.cancel ?? false;
        throw new Error("辅助连接中断");
      }
      const value =
        stage === "judge"
          ? {
              read: "安排取药",
              ooc: options.ooc ?? false,
              ruling: null,
              buy: null,
              recall: [],
              foes: null,
            }
          : stage === "extract"
            ? (options.extract ?? {
                changes: [],
                sceneEnd: true,
                choices: [],
                sceneMemory: working,
                summary,
              })
            : stage === "summary"
              ? (options.summary ?? summary)
              : stage === "offscreen"
                ? (options.offscreen ?? { events: [], npcs: [], messages: [] })
                : stage === "repair"
                  ? { fixes: [] }
                  : narrative;
      yield { type: "text", text: typeof value === "string" ? value : JSON.stringify(value) };
      yield { type: "done", finishReason: "stop" };
    },
  };
  const result = await runNarratorTurn(
    {
      llm,
      rng: { roll: () => 1 },
      data: { items: [] },
      offscreen: options.enabled ? 1 : null,
      signal,
    },
    world,
    options.records ?? [],
    { kind: "action", input: TurnInputSchema.parse({ text: input }) },
  );
  expect(result.kind).toBe("done");
  if (result.kind !== "done") throw new Error("回合未完成");
  return { turn: result.turn, requests };
}

function record(turn: NarratorTurn, seq: number): TurnRecord {
  return {
    kind: "turn",
    seq,
    at: "2077-08-20T21:00:00Z",
    requestId: `memory-${seq}`,
    baseVersion: seq,
    input: { text: input },
    dice: [],
    commands: [...turn.commands],
    dropped: [...turn.dropped],
    text: turn.text,
    patches: [...turn.patches],
    scene: turn.scene,
  };
}

describe("正文优先的场景记忆回合", () => {
  it("正常收场三次调用，独立保留未实行计划，重放及撤回一致", async () => {
    const initial = newGameWorld({ startTime: 1000 });
    const { turn, requests } = await run(initial);
    expect(requests.map((r) => r.responseFormat?.name)).toEqual(["judge", undefined, "extract"]);
    expect(turn.summary).toBeUndefined();
    const memory = MemoryStateSchema.parse(turn.world.slices.memory);
    expect(memory.active).toBeNull();
    expect(memory.scenes[0]).toMatchObject({ scene: turn.scene, text: summary.text });
    expect(memory.anchors[anchor.id]).toMatchObject({ kind: "plan", resolution: null });
    const first = record(turn, 0);
    const records: LogRecord[] = [first];
    expect(replay({ nextSeq: 0, world: initial }, records)).toEqual(turn.world);
    const second = await run(turn.world, {
      records,
      extract: { changes: [], sceneMemory: { text: "你站在街角看雨。", anchors: [], resolve: [] } },
    });
    records.push(record(second.turn, 1));
    expect(replay({ nextSeq: 1, world: turn.world }, records)).toEqual(
      replay({ nextSeq: 0, world: initial }, records),
    );
    expect(
      MemoryStateSchema.parse(second.turn.world.slices.memory).anchors[anchor.id]?.resolution,
    ).toBeNull();
    expect(second.requests[0]?.messages.map((m) => m.content).join("\n")).toContain("尚未实行");
    records.push({ kind: "void", seq: 2, at: first.at, target: 1, reason: "undo" });
    expect(replay({ nextSeq: 0, world: initial }, records)).toEqual(turn.world);
  });

  it.each([undefined, { ...summary, text: "事情结束了。" }])(
    "合并摘要缺失或贫乏时补调摘要，不为省调用丢记忆",
    async (merged) => {
      const { turn, requests } = await run(undefined, {
        extract: { changes: [], sceneEnd: true, sceneMemory: working, summary: merged },
      });
      expect(requests.filter((r) => r.responseFormat?.name === "summary")).toHaveLength(1);
      expect(turn.summary).toBeDefined();
      expect(MemoryStateSchema.parse(turn.world.slices.memory).scenes[0]?.text).toBe(summary.text);
    },
  );

  it.each(["ooc", "flashback", "unsettled"])("%s 不污染现在线记忆", async (kind) => {
    let world = newGameWorld({ startTime: 1000 });
    if (kind === "flashback")
      world = {
        ...world,
        slices: {
          ...world.slices,
          character: {
            ...(world.slices.character as object),
            flashback: { past: "旧事", startedAt: world.time, turns: 0 },
          },
        },
      };
    const { turn } = await run(world, {
      ooc: kind === "ooc",
      extract: {
        changes: kind === "unsettled" ? [{ type: "money", delta: "invalid" }] : [],
        sceneEnd: true,
        sceneMemory: working,
        summary,
      },
    });
    expect(turn.world.slices.memory).toEqual(world.slices.memory);
    if (kind === "unsettled") expect(turn.unsettled).toBeDefined();
  });

  it("抽取漏记场景提要时保留已有记忆，不废弃有效正文", async () => {
    const first = await run(undefined, { extract: { changes: [], sceneMemory: working } });
    const next = await run(first.turn.world, { extract: { changes: [] } });
    expect(next.turn.unsettled).toBeUndefined();
    expect(next.turn.world.slices.memory).toEqual(first.turn.world.slices.memory);
    expect(next.turn.considered.some((n) => n.includes("保留此前记忆"))).toBe(true);
  });

  it("结束闪回的过往事实只保存一次，读档重放和撤回与本轮状态一致", async () => {
    const initial = newGameWorld({ startTime: 1000 });
    const world = {
      ...initial,
      slices: {
        ...initial.slices,
        character: {
          ...(initial.slices.character as object),
          flashback: { past: "旧事", startedAt: initial.time, turns: 2 },
        },
      },
    };
    const { turn } = await run(world, {
      extract: {
        changes: [{ type: "flashback", action: "end", fact: "那把钥匙是老朋友交给你的。" }],
      },
    });
    const entry = record(turn, 0);
    expect(turn.world.slices.character).toMatchObject({
      flashback: null,
      pastFacts: [{ past: "旧事", text: "那把钥匙是老朋友交给你的。" }],
    });
    expect(replay({ nextSeq: 0, world }, [entry])).toEqual(turn.world);
    expect(
      replay({ nextSeq: 0, world }, [
        entry,
        { kind: "void", seq: 1, at: entry.at, target: 0, reason: "undo" },
      ]),
    ).toEqual(world);
  });

  it("两份收场摘要都失败仍保留完整提要，下一场更新后旧提要仍可检索", async () => {
    const { turn } = await run(undefined, {
      extract: { changes: [], sceneEnd: true, sceneMemory: working },
      summary: "不是可用的摘要",
    });
    expect(MemoryStateSchema.parse(turn.world.slices.memory).scenes).toEqual([]);
    expect(memoryPool(turn.world, [], 12).some((entry) => entry.text.includes(working.text))).toBe(
      true,
    );
    const next = await run(turn.world, {
      extract: {
        changes: [],
        sceneMemory: { text: "你来到街角等候。", anchors: [], resolve: [] },
      },
    });
    const memory = MemoryStateSchema.parse(next.turn.world.slices.memory);
    expect(memory.pending[String(turn.scene)]?.text).toBe(working.text);
    expect(
      memoryPool(next.turn.world, [], 12).some((entry) => entry.text.includes(working.text)),
    ).toBe(true);
    expect(memory.anchors[anchor.id]?.resolution).toBeNull();
  });
});

describe("场外推演批次不完整时可靠恢复", () => {
  it.each(["offscreen", "summary"] as const)(
    "%s 连接中断仍保存正文，用户主动取消则停止",
    async (failStage) => {
      const options = {
        enabled: true,
        failStage,
        extract: { changes: [], sceneEnd: true, sceneMemory: working },
      };
      const { turn } = await run(undefined, options);
      expect(turn.text).toBe(narrative);
      expect(
        MemoryStateSchema.parse(turn.world.slices.memory).anchors[anchor.id]?.resolution,
      ).toBeNull();
      if (failStage === "offscreen")
        expect(CityStateSchema.parse(turn.world.slices.city).failures).toBe(1);
      else
        expect(
          memoryPool(turn.world, [], 12).some((entry) => entry.text.includes(working.text)),
        ).toBe(true);
      await expect(run(undefined, { ...options, cancel: true })).rejects.toBeInstanceOf(
        NarratorAbortedError,
      );
    },
  );

  it("合法格式里的业务非法操作也整批回滚，不泄漏前面已应用的事件", async () => {
    const { turn } = await run(undefined, {
      enabled: true,
      offscreen: {
        events: [
          {
            id: "restock",
            title: "补货车驶入街区",
            body: "供应商发来的货车已进入诊所所在街区",
            status: "brewing",
            weight: "minor",
          },
        ],
        npcs: [],
        messages: [],
        threads: [
          {
            type: "thread.open",
            id: "illegal-owner",
            kind: "faction",
            owner: "missing-faction",
            title: "外来公司",
            want: "接管诊所",
            stage: "派人调查",
            days: 1,
          },
        ],
      },
    });
    expect(turn.considered.some((n) => n.includes("批次未提交：thread.open"))).toBe(true);
    expect(CityStateSchema.parse(turn.world.slices.city)).toMatchObject({
      events: [],
      failures: 1,
      lastAt: null,
    });
    expect(ThreadsStateSchema.parse(turn.world.slices.threads).threads).toEqual([]);
  });

  it("不提交半份事件、不挪待办期限，退避后成功一次并可重放撤回", async () => {
    const base = newGameWorld({ startTime: 1000 });
    const initial = {
      ...base,
      slices: {
        ...base.slices,
        threads: ThreadsStateSchema.parse({
          threads: [
            {
              id: "clinic-restock",
              kind: "faction",
              owner: "clinic",
              title: "诊所补货",
              want: "补充药品",
              stage: "等待货车",
              openedAt: 900,
              dueAt: 999,
              reminded: true,
            },
          ],
        }),
      },
    };
    const { turn, requests } = await run(initial, {
      enabled: true,
      offscreen: {
        events: [
          {
            id: "restock",
            title: "补货车驶入街区",
            body: "供应商发来的货车已进入诊所所在街区",
            status: "brewing",
            weight: "minor",
          },
        ],
        npcs: [{ id: "missing-person", doing: "离开街区" }],
        messages: [],
      },
    });
    expect(requests.filter((r) => r.responseFormat?.name === "offscreen")).toHaveLength(1);
    const city = CityStateSchema.parse(turn.world.slices.city);
    expect(city).toMatchObject({ events: [], lastAt: null, processedThrough: -1, failures: 1 });
    expect(city.retryAt).toBe(turn.world.time + 15);
    expect(turn.world.slices.threads).toEqual(initial.slices.threads);
    const first = record(turn, 0);
    expect(replay({ nextSeq: 0, world: initial }, [first])).toEqual(turn.world);
    const during = await run(turn.world, {
      enabled: true,
      records: [first],
      extract: { changes: [], sceneMemory: { text: "你在街边等待。", anchors: [], resolve: [] } },
    });
    expect(during.requests.filter((r) => r.responseFormat?.name === "offscreen")).toHaveLength(0);
    const retry = await run(during.turn.world, {
      enabled: true,
      records: [first, record(during.turn, 1)],
      extract: {
        changes: [{ type: "world", time: city.retryAt, activity: "wait" }],
        sceneMemory: { text: "你在街边等了一会儿。", anchors: [], resolve: [] },
      },
    });
    expect(retry.requests.filter((r) => r.responseFormat?.name === "offscreen")).toHaveLength(1);
    expect(CityStateSchema.parse(retry.turn.world.slices.city)).toMatchObject({
      failures: 0,
      retryAt: null,
      processedThrough: 2,
      lastAt: city.retryAt,
    });
    const records: LogRecord[] = [first, record(during.turn, 1), record(retry.turn, 2)];
    expect(replay({ nextSeq: 0, world: initial }, records)).toEqual(retry.turn.world);
    records.push({ kind: "void", seq: 3, at: first.at, target: 2, reason: "undo" });
    expect(replay({ nextSeq: 0, world: initial }, records)).toEqual(during.turn.world);
  });
});
