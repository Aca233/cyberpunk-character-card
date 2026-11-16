import { applyPatches } from "immer";
import { describe, expect, it } from "vitest";
import { seededRng } from "../kernel/rng";
import type { Command } from "../kernel/system";
import type { WorldState } from "../kernel/world";
import {
  type MemoryAnchorFields,
  MemoryStateSchema,
  type MemoryWorkingCommand,
} from "../systems/memory";
import { NpcSchema } from "../systems/npc";
import { registry } from "../systems/registry";
import { parseGameTime, WorldClockStateSchema } from "../systems/world";
import { ExtractDocSchema } from "./block";
import { buildExtractPrompt, buildJudgePrompt, buildNarratorPrompt } from "./prompts";
import { EXTRACT_EXAMPLE } from "./prompts/extract";
import { memoryPool } from "./retrieve";
import { readSceneMemory, sceneMemorySection, summaryFromExtract } from "./scene-memory";
import { buildSummaryPrompt, readSummary } from "./summary";

const ctx = { rng: seededRng(27) };
const input = { text: "我答应明天九点把芯片交给你。" };
const narrative = "老莫点头，收起终端。他没有拿到芯片，双方也没有转账。";
const promise: MemoryAnchorFields = {
  id: "chip-delivery",
  kind: "promise",
  text: "你答应在2077-01-02 09:00向老莫交芯片，尚未交付。",
  people: [],
  keywords: ["芯片", "老莫"],
  evidence: { source: "input", quote: "我答应明天九点把芯片交给你" },
};
function start(): WorldState {
  return registry.initialWorld(parseGameTime("2077-01-01 22:00") as number);
}
function working(world: WorldState, anchors = [promise]): MemoryWorkingCommand {
  const clock = WorldClockStateSchema.parse(world.slices.world);
  return {
    type: "memory.working",
    scene: clock.scene,
    place: clock.location,
    text: "你与老莫约好次日上午交芯片，目前尚未交付也未转账。",
    anchors,
    resolve: [],
  };
}
function apply(world: WorldState, command: Command): WorldState {
  const result = registry.applyCommands(world, [command], ctx);
  expect(result.results[0]?.result.ok).toBe(true);
  return result.world;
}
function summary(text: string) {
  return {
    title: "芯片约定",
    text,
    people: [],
    importance: "normal",
    keywords: ["芯片", "老莫"],
  };
}

describe("场景记忆与独立锚点", () => {
  it("后续提要省略早期承诺也不删锚点，收场后仍能检索；补丁和存盘保留完整记录", () => {
    const before = start();
    const checked = readSceneMemory(working(before), before, before, input, narrative);
    expect(checked.notes).toEqual([]);
    const result = registry.applyCommands(before, [checked.command as MemoryWorkingCommand], ctx);
    expect(applyPatches(before, result.patches)).toEqual(result.world);
    let world = apply(result.world, { ...working(before, []), text: "双方继续聊市场的行情。" });
    world = apply(world, {
      type: "memory.scene",
      scene: working(before).scene,
      place: null,
      ...summary("你与老莫在市场谈过交易，并约定次日上午交付芯片；目前交易尚未完成。"),
    });
    const saved = MemoryStateSchema.parse(JSON.parse(JSON.stringify(world.slices.memory)));
    expect(saved.active).toBeNull();
    expect(saved.anchors[promise.id]?.text).toBe(promise.text);
    expect(saved.anchors[promise.id]?.resolution).toBeNull();
    expect(memoryPool(world, [], 12).find((m) => m.id === "anchor:chip-delivery")?.text).toContain(
      "尚未兑现",
    );
  });

  it("漏写或伪造证据只拒绝记忆更新，旧提要和承诺不受影响", () => {
    const before = start();
    const world = apply(before, working(before));
    for (const raw of [
      undefined,
      {
        ...working(world),
        anchors: [{ ...promise, evidence: { source: "narrative", quote: "你交出了芯片" } }],
      },
    ]) {
      const result = readSceneMemory(raw, world, world, input, narrative);
      expect(result.command).toBeUndefined();
      expect(result.notes.join()).toContain("保留此前记忆");
    }
    expect(MemoryStateSchema.parse(world.slices.memory).active?.text).toBe(working(world).text);
  });

  it("问题不能当承诺兑现、事实不能勾销、未知或重复结果整份拒绝", () => {
    let world = start();
    world = apply(
      world,
      working(world, [
        promise,
        { ...promise, id: "killer", kind: "question" },
        { ...promise, id: "meeting", kind: "fact" },
      ]),
    );
    const resolution = {
      id: promise.id,
      outcome: "fulfilled" as const,
      text: "你把芯片交给了老莫。",
      evidence: { source: "input" as const, quote: "把芯片交给老莫" },
    };
    for (const resolve of [
      [{ ...resolution, id: "unknown" }],
      [{ ...resolution, id: "meeting" }],
      [{ ...resolution, id: "killer" }],
      [{ ...resolution, outcome: "answered" }],
      [resolution, resolution],
    ]) {
      const command = { ...working(world, []), resolve };
      expect(
        readSceneMemory(command, world, world, { text: "把芯片交给老莫" }, "老莫接过芯片。")
          .command,
      ).toBeUndefined();
      const applied = registry.applyCommands(world, [command], ctx);
      expect(applied.results[0]?.result.ok).toBe(false);
      expect(applied.world).toEqual(world);
    }
  });

  it("兑现保留原承诺及证据，并单独记结果和时间", () => {
    let world = start();
    world = apply(world, working(world));
    const later = registry.advanceTo(world, world.time + 600, ctx).world;
    const checked = readSceneMemory(
      {
        ...working(world, []),
        resolve: [
          {
            id: promise.id,
            outcome: "fulfilled",
            text: "你已当面交付芯片。",
            evidence: { source: "input", quote: "把芯片交给老莫" },
          },
        ],
      },
      world,
      later,
      { text: "把芯片交给老莫" },
      "老莫接过了芯片。",
    );
    const finished = apply(later, checked.command as MemoryWorkingCommand);
    const anchor = MemoryStateSchema.parse(finished.slices.memory).anchors[promise.id];
    expect(anchor?.text).toBe(promise.text);
    expect(anchor?.evidence).toEqual(promise.evidence);
    expect(anchor?.resolution).toMatchObject({ outcome: "fulfilled", at: later.time });
    expect(sceneMemorySection(finished)).toContain("登记于 2077-01-01 22:00");
    expect(sceneMemorySection(finished)).toContain("结果记于 2077-01-02 08:00");
  });

  it("本轮刚建立的人物可用于锚点，尚未登记的人物不行", () => {
    const before = start();
    const npc = NpcSchema.parse({
      id: "old-mo",
      name: "老莫",
      pronoun: "他",
      role: "中间人",
      look: "旧外套，脸上有疤",
      voice: "简短",
      want: "收芯片",
      limit: "不能失信",
      affinity: 0,
      alive: true,
      met: true,
      location: "kabuki-market",
      lastSeenAt: before.time,
      memories: [],
    });
    const after = { ...before, slices: { ...before.slices, npc: { npcs: { "old-mo": npc } } } };
    const raw = { ...working(before), anchors: [{ ...promise, people: ["old-mo"] }] };
    expect(readSceneMemory(raw, before, before, input, narrative).command).toBeUndefined();
    expect(readSceneMemory(raw, before, after, input, narrative).command).toBeDefined();
  });

  it("判断、正文和抽取各收到一次早期承诺，未展示锚点保持持久并可检索", () => {
    const base = start();
    const anchors = Array.from({ length: 24 }, (_, n) => ({
      ...promise,
      id: `promise-${n}`,
      text: `第${n}项旧承诺仍未完成`,
      keywords: [`信物${n}`],
    }));
    const world = apply(base, working(base, anchors));
    const plan = { kind: "action" as const, input: { text: "信物23的约定是什么？" } };
    const section = sceneMemorySection(world, plan.input.text) as string;
    expect(section.length).toBeLessThanOrEqual(2000);
    expect(section).toContain("promise-23");
    expect(section.match(/^- promise-/gm)?.length).toBeLessThanOrEqual(8);
    for (const prompt of [
      buildJudgePrompt(world, [], plan, { data: { items: [] } }, []),
      buildNarratorPrompt(world, [], plan, { data: { items: [] } }),
      buildExtractPrompt(world, [], plan, { data: { items: [] } }, narrative),
    ]) {
      const text = prompt.messages
        .filter((m) => m.role === "user")
        .map((m) => m.content)
        .join("\n");
      expect(text.split("【场景记忆与未完事项】")).toHaveLength(2);
      expect(text).toContain("promise-23");
    }
    expect(memoryPool(world, [], 12).filter((m) => m.kind === "anchor")).toHaveLength(24);
    expect(ExtractDocSchema.safeParse(JSON.parse(EXTRACT_EXAMPLE)).success).toBe(true);
  });
});

describe("摘要质量与恢复材料", () => {
  it("短场景允许短而具体的摘要，长场景拒绝空泛过短或无本场来源的内容", () => {
    const world = start();
    const scene = working(world).scene;
    const short = { input: { text: "把芯片交给老莫。" }, narrative: "老莫接过芯片，点了点头。" };
    expect(
      summaryFromExtract(
        summary("你把芯片交给老莫，他接过后点头确认，交接完成。"),
        world,
        scene,
        null,
        short,
      ).command,
    ).toBeDefined();
    const long = { ...short, narrative: narrative.repeat(20) };
    expect(
      summaryFromExtract(summary("你把芯片交给老莫。"), world, scene, null, long).command,
    ).toBeUndefined();
    expect(
      summaryFromExtract(
        summary("今天的行动暂时告一段落，大家都准备迎接未来。"),
        world,
        scene,
        null,
        short,
      ).command,
    ).toBeUndefined();
  });

  it("恢复摘要保留早期锚点、完整当前正文，不截断超长摘要结尾的限定语", () => {
    const before = start();
    const after = apply(before, working(before));
    const source = { input, narrative };
    const content = buildSummaryPrompt(before, after, [], input, narrative, {})
      .map((m) => m.content)
      .join("\n");
    expect(content).toContain("2077-01-02 09:00");
    expect(content).toContain("尚未兑现");
    expect(content).toContain(narrative);
    const tooLong = summary(`${"你和老莫聊了芯片的交付安排。".repeat(20)}但芯片仍未交付。`);
    expect(
      readSummary(JSON.stringify(tooLong), after, working(before).scene, null, source).command,
    ).toBeUndefined();
    expect(MemoryStateSchema.parse(after.slices.memory).active).not.toBeNull();
  });
});
