import { applyPatches } from "immer";
import { describe, expect, it } from "vitest";
import { seededRng } from "../kernel/rng";
import type { Command } from "../kernel/system";
import type { LogRecord, TurnRecord } from "../kernel/turnlog";
import type { WorldState } from "../kernel/world";
import { MemoryStateSchema, memoryRecords } from "../systems/memory";
import { registry } from "../systems/registry";
import { buildExtractPrompt, buildJudgePrompt, buildNarratorPrompt } from "./prompts";
import { memoryPool } from "./retrieve";
import { sceneMemorySection } from "./scene-memory";

const ctx = { rng: seededRng(16), facts: { memorySourceThrough: 1 } };
const mistaken = "你已经买到蓝色药剂并付了款。";
const corrected = "你只是计划去买蓝色药剂，目前没有买到，也没有付款。";
const other = "老莫答应周末来修门锁，尚未来过。";
function apply(world: WorldState, commands: Command[]): WorldState {
  const result = registry.applyCommands(world, commands, ctx);
  expect(result.results.every(({ result }) => result.ok)).toBe(true);
  expect(applyPatches(world, result.patches)).toEqual(result.world);
  return result.world;
}
function working(scene: number, id: string, text: string, kind = "fact") {
  return {
    type: "memory.working",
    scene,
    place: null,
    text,
    anchors: [
      {
        id,
        kind,
        text,
        people: [],
        keywords: ["蓝色药剂", "门锁"],
        evidence: { source: "narrative", quote: text },
      },
    ],
    resolve: [],
  };
}
function summary(scene: number, text: string) {
  return {
    type: "memory.scene",
    scene,
    place: null,
    title: "药剂安排",
    text,
    people: [],
    importance: "normal",
    keywords: ["药剂", "安排"],
  };
}
function start(): WorldState {
  return apply(registry.initialWorld(1000), [
    working(0, "bad-purchase", mistaken),
    summary(0, mistaken),
    working(1, "repair-promise", other, "promise"),
    summary(1, other),
  ]);
}
function turn(seq: number, scene: number, text: string): TurnRecord {
  return {
    kind: "turn",
    seq,
    scene,
    at: "2077-01-01",
    requestId: `correction-${seq}`,
    baseVersion: seq,
    input: { text: "继续观察" },
    text,
    commands: [],
    dropped: [],
    dice: [],
    patches: [],
  };
}
const records: LogRecord[] = [turn(0, 0, mistaken), turn(1, 1, other)];

describe("玩家纠正记忆后的来源失效", () => {
  it("正文纠错使同场原文和派生锚点失效，修正内容进入三阶段且其他场景完整保留", () => {
    const original = start();
    const saved = MemoryStateSchema.parse(original.slices.memory);
    const stale = { scene: 0, place: null, text: mistaken, at: original.time };
    const before = {
      ...original,
      slices: { ...original.slices, memory: { ...saved, active: stale, pending: { "0": stale } } },
    };
    const world = apply(before, [
      { type: "memory.edit", scene: 0, before: mistaken, action: "edit", text: corrected },
    ]);
    const memory = MemoryStateSchema.parse(world.slices.memory);
    expect(memory.anchors["bad-purchase"]).toBeUndefined();
    expect(memory.active).toBeNull();
    expect(memory.pending["0"]).toBeUndefined();
    expect(memory.anchors["repair-promise"]?.text).toBe(other);
    expect(memoryRecords(world, records)).toEqual([records[1]]);
    expect(memoryPool(world, records, 0).some((entry) => entry.text.includes(mistaken))).toBe(
      false,
    );
    expect(sceneMemorySection(world)).not.toContain(mistaken);
    const plan = { kind: "action" as const, input: { text: "蓝色药剂到手了吗？" } };
    const extras = { data: { items: [] } };
    for (const prompt of [
      buildJudgePrompt(world, records, plan, extras, []),
      buildNarratorPrompt(world, records, plan, extras),
      buildExtractPrompt(world, records, plan, extras, "你仍未取到药剂。"),
    ]) {
      const text = prompt.messages.map((message) => message.content).join("\n");
      expect(text).not.toContain(mistaken);
      // 抽取共用的现状直接带玩家纠错，不能只靠只在正文阶段出现的前情。
      expect(text).toContain(corrected);
    }
    expect(records[0]).toMatchObject({ text: mistaken });
  });

  it("只调标题或重要度不否定原事实", () => {
    const before = start();
    const world = apply(before, [
      {
        type: "memory.edit",
        scene: 0,
        before: mistaken,
        action: "edit",
        title: "药剂线索",
        importance: "key",
      },
    ]);
    const memory = MemoryStateSchema.parse(world.slices.memory);
    expect(memory.corrections).toEqual({});
    expect(memory.anchors).toEqual(MemoryStateSchema.parse(before.slices.memory).anchors);
    expect(memoryRecords(world, records)).toEqual(records);
  });

  it("删除摘要同时撤销同场来源，旧摘要不能重新覆盖；其他场摘要不受影响", () => {
    const before = start();
    const world = apply(before, [
      { type: "memory.edit", scene: 0, before: mistaken, action: "remove" },
    ]);
    const memory = MemoryStateSchema.parse(world.slices.memory);
    expect(memory.scenes.map((entry) => entry.scene)).toEqual([1]);
    expect(memory.anchors["bad-purchase"]).toBeUndefined();
    expect(memoryRecords(world, records)).toEqual([records[1]]);
    for (const command of [summary(0, mistaken)]) {
      const result = registry.applyCommands(world, [command], ctx);
      expect(result.results[0]?.result.ok).toBe(false);
      expect(result.world).toEqual(world);
    }
  });

  it("同场纠错后的新正文仍可用，未结算草稿始终排除；原始日志保留", () => {
    const world = apply(start(), [
      { type: "memory.edit", scene: 0, before: mistaken, action: "edit", text: corrected },
    ]);
    const latest = turn(2, 0, "现在你确实收到药剂。"),
      draft = { ...turn(3, 2, "半句话"), unsettled: "输出被截断" };
    const history = [...records, latest, draft];
    expect(memoryRecords(world, history)).toEqual([records[1], latest]);
    expect(history).toHaveLength(4);
  });

  it("纠正后来那场结果会重开更早的承诺，不删除原承诺", () => {
    let world = apply(registry.initialWorld(1000), [
      working(0, "promise", other, "promise"),
      summary(0, other),
    ]);
    world = apply(world, [
      {
        ...working(1, "result", "门锁已修好。"),
        anchors: [],
        resolve: [
          {
            id: "promise",
            outcome: "fulfilled",
            text: "门锁已修好。",
            evidence: { source: "narrative", quote: "门锁已修好" },
          },
        ],
      },
      summary(1, "门锁已修好。"),
    ]);
    expect(MemoryStateSchema.parse(world.slices.memory).anchors.promise?.resolution?.scene).toBe(1);
    world = apply(world, [
      {
        type: "memory.edit",
        scene: 1,
        before: "门锁已修好。",
        action: "edit",
        text: "老莫只是来检查门锁，还没有修理。",
      },
    ]);
    expect(MemoryStateSchema.parse(world.slices.memory).anchors.promise).toMatchObject({
      text: other,
      resolution: null,
    });
  });
});
