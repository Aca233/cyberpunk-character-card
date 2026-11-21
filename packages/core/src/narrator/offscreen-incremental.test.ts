import { describe, expect, it } from "vitest";
import { seededRng } from "../kernel/rng";
import type { Command } from "../kernel/system";
import { replay, type TurnRecord } from "../kernel/turnlog";
import type { WorldState } from "../kernel/world";
import { CityStateSchema } from "../systems/city";
import { registry } from "../systems/registry";
import {
  buildMacroOffscreenPrompt,
  buildSocialOffscreenPrompt,
  lifePicks,
  offscreenDue,
  prepareMacroOffscreenBatch,
  readMacroOffscreen,
  readSocialOffscreen,
} from "./offscreen";

const ctx = { rng: seededRng(2) };
const T0 = 1000;
const emptyMacro = { situations: [] };
const emptySocial = { npcs: [], messages: [] };

function apply(world: WorldState, commands: Command[]) {
  const result = registry.applyCommands(world, commands, ctx);
  expect(result.results.every((r) => r.result.ok)).toBe(true);
  return result;
}
function start(): WorldState {
  return registry.initialWorld(T0);
}
function seed(world: WorldState, id: string, name: string) {
  return apply(world, [
    {
      type: "npc.seed",
      id,
      name,
      pronoun: "她",
      role: "维修工",
      look: "工装",
      voice: `${name}独有口吻`,
      want: `${name}独有诉求`,
      limit: "不出卖同伴",
      secret: `${name}私下计划`,
      home: "workshop",
    },
  ]).world;
}
function turn(seq: number, text: string, more: Partial<TurnRecord> = {}): TurnRecord {
  return {
    kind: "turn",
    seq,
    at: "2077-01-01T00:00:00Z",
    requestId: `r${seq}`,
    baseVersion: seq,
    input: { text: "看看" },
    dice: [],
    commands: [],
    dropped: [],
    text,
    patches: [],
    scene: 0,
    ...more,
  };
}
function macroPrompt(world: WorldState, records: TurnRecord[] = [], text = "这轮没有新动作") {
  return (
    buildMacroOffscreenPrompt(world, records, { data: { items: [], cyberware: [] } }, text)[1]
      ?.content ?? ""
  );
}
function socialPrompt(world: WorldState, records: TurnRecord[] = [], text = "这轮没有新动作") {
  return (
    buildSocialOffscreenPrompt(
      world,
      records,
      { data: { items: [], cyberware: [] } },
      text,
      new Set(),
    )[1]?.content ?? ""
  );
}

describe("双路场外推演成功游标与失败退避", () => {
  it.each([T0, T0 + 10])("同一分钟刚推动的局势也触发推演，旧期限 %i", (dueAt) => {
    const initial = start();
    const seeded: WorldState = {
      ...initial,
      slices: {
        ...initial.slices,
        threads: {
          closed: [],
          threads: [
            {
              id: "delivery",
              kind: "faction",
              owner: "crew",
              seed: null,
              title: "送货",
              district: "沃森",
              weight: "normal",
              status: "brewing",
              want: "把货交到仓库",
              stage: "等待放行",
              openedAt: T0 - 10,
              dueAt,
              reminded: false,
              steps: [],
            },
          ],
        },
      },
    };
    const before = apply(seeded, [{ type: "city.ran", through: 5, backlog: false }]).world;
    const pushed = apply(before, [
      { type: "thread", id: "delivery", move: "push", reason: "玩家替货车打开闸门" },
    ]).world;
    expect(offscreenDue(before, pushed)).toBe(true);
    const processed = apply(pushed, [{ type: "city.ran", through: 6, backlog: false }]).world;
    expect(offscreenDue(processed, processed)).toBe(false);
  });

  it("失败不覆盖成功范围，退避期间即使有期限到期也不重试", () => {
    const previous = apply(start(), [{ type: "city.ran", through: 5, backlog: false }]).world;
    const later = registry.advanceTo(previous, T0 + 10, ctx).world;
    const failed = apply(later, [
      { type: "deadline", action: "add", id: "delivery", label: "货到了", due: T0 + 11 },
      { type: "city.failed" },
    ]).world;
    expect(CityStateSchema.parse(failed.slices.city)).toMatchObject({
      lastAt: T0,
      lastScene: 0,
      processedThrough: 5,
      lastAttemptAt: T0 + 10,
      retryAt: T0 + 25,
      failures: 1,
    });
    const beforeRetry = registry.advanceTo(failed, T0 + 24, ctx).world;
    expect(offscreenDue(failed, beforeRetry)).toBe(false);
    expect(offscreenDue(beforeRetry, registry.advanceTo(beforeRetry, T0 + 25, ctx).world)).toBe(
      true,
    );
  });

  it("连续失败按游戏分钟递增退避，成功后清零；保存的补丁重放保持相同游标", () => {
    let world = start();
    for (const minutes of [15, 30, 60, 120, 120]) {
      world = apply(world, [{ type: "city.failed" }]).world;
      const city = CityStateSchema.parse(world.slices.city);
      expect(city.retryAt).toBe(world.time + minutes);
      world = registry.advanceTo(world, world.time + minutes, ctx).world;
    }
    const result = apply(world, [{ type: "city.ran", through: 7, backlog: false }]);
    expect(CityStateSchema.parse(result.world.slices.city)).toMatchObject({
      lastAt: world.time,
      processedThrough: 7,
      failures: 0,
      retryAt: null,
    });
    const records = [turn(0, "完成", { patches: [...result.patches] })];
    expect(replay({ world, nextSeq: 0 }, records)).toEqual(result.world);
  });
});

describe("分级容错解析（L0 硬失败 vs L1/L2 局部降级）", () => {
  it("L0 顶层非 JSON 或缺核心数组才失败", () => {
    expect(readMacroOffscreen(JSON.stringify(emptyMacro), start()).ok).toBe(true);
    expect(readSocialOffscreen(JSON.stringify(emptySocial), start()).ok).toBe(true);
    for (const value of ["拒绝输出", "{}", "null", JSON.stringify({ situations: null })]) {
      expect(readMacroOffscreen(value, start()).ok).toBe(false);
    }
    for (const value of ["拒绝输出", "{}", "null", JSON.stringify({ npcs: null, messages: [] })]) {
      expect(readSocialOffscreen(value, start()).ok).toBe(false);
    }
  });

  it("L2 单条无效跳过，合法条目仍正常保留且整批成功", () => {
    const got = readMacroOffscreen(
      JSON.stringify({
        situations: [
          {
            op: "open",
            id: "power-cut",
            kind: "civic",
            title: "断电",
            stage: "变电站故障",
            truth: "变电站故障导致片区停电",
            status: "brewing",
            weight: "normal",
            days: 2,
          },
          { id: "broken" },
        ],
      }),
      start(),
    );
    expect(got.ok).toBe(true);
    expect(got.commands.some((c) => c.type === "thread.open")).toBe(true);
    expect(got.notes.some((n) => n.includes("已跳过"))).toBe(true);
  });

  it("重复近况只跳过多余条目，不拖累整批人物推演", () => {
    const world = seed(start(), "n-one", "甲");
    const got = readSocialOffscreen(
      JSON.stringify({
        npcs: [
          { id: "n-one", doing: "修发动机" },
          { id: "n-one", doing: "喝咖啡" },
        ],
        messages: [],
      }),
      world,
    );
    expect(got.ok).toBe(true);
    expect(got.commands.filter((c) => c.type === "npc.offscreenDoing")).toHaveLength(1);
  });
});

describe("场外推演增量材料", () => {
  it("按成功 seq 选正文，同一分钟的新行动保留；不带旧轮、出戏和未定稿", () => {
    const world = apply(start(), [{ type: "city.ran", through: 2, backlog: false }]).world;
    const text = macroPrompt(world, [
      turn(2, "已经处理的独特事实"),
      turn(3, "同一分钟的新行动"),
      turn(4, "出戏说明甲", { ooc: true }),
      turn(5, "出戏说明乙", { input: { text: "问规则", mode: "ooc" } }),
      turn(6, "未定稿事故", { unsettled: "账没记完" }),
    ]);
    expect(text).toContain("同一分钟的新行动");
    for (const omitted of ["已经处理的独特事实", "出戏说明甲", "出戏说明乙", "未定稿事故"])
      expect(text).not.toContain(omitted);
  });

  it("社交推演包含相关人物详卡、远端轮换者和完整索引", () => {
    let world = start();
    for (let i = 0; i < 18; i += 1)
      world = seed(world, `npc-${String(i).padStart(2, "0")}`, `工友${i}号`);
    const text = socialPrompt(
      world,
      [],
      Array.from({ length: 14 }, (_, i) => `工友${i + 2}号`).join("、"),
    );
    for (let i = 2; i < 16; i += 1) {
      expect(text).toContain(`想要：工友${i}号独有诉求`);
      expect(text).toContain(`口吻：工友${i}号独有口吻`);
    }
    for (const n of lifePicks(world)) expect(text).toContain(`想要：${n.want}`);
    expect(text).toContain("npc-17｜工友17号");
    expect(text).not.toContain("想要：工友17号独有诉求");
  });
});

describe("场外积压按辅助模型窗口分批", () => {
  const extras = { data: { items: [], cyberware: [] } };
  const capacity = { contextWindow: 32_000, maxOutputTokens: 2048 };
  const current = "你在街角停下，当前没有新的场外行动。";
  const prepare = (
    world: WorldState,
    records: TurnRecord[],
    narrative = current,
    budget = capacity,
  ) => prepareMacroOffscreenBatch(world, records, extras, narrative, budget);

  it("两百轮积压分批读取完整因果，既不跳过旧轮也不重复处理", () => {
    const records = Array.from({ length: 200 }, (_, i) =>
      turn(i, `${"城里发生了旧事。".repeat(170)}独特因果结尾[${i}]。`),
    );
    let world = start();
    const occurrences = new Map<number, number>();
    let batches = 0;
    for (; batches <= records.length; batches++) {
      const batch = prepare(world, records);
      expect(batch.kind).toBe("ready");
      if (batch.kind !== "ready") throw new Error(batch.reason);
      expect(batch.inputTokens).toBeLessThanOrEqual(batch.inputLimit);
      const text = batch.messages.map((m) => m.content).join("\n");
      for (const match of text.matchAll(/独特因果结尾\[(\d+)\]/g)) {
        const seq = Number(match[1]);
        occurrences.set(seq, (occurrences.get(seq) ?? 0) + 1);
      }
      world = apply(world, [
        { type: "city.ran", track: "macro", through: batch.through, backlog: batch.backlog },
      ]).world;
      if (!batch.backlog) break;
    }
    expect(batches).toBeGreaterThan(1);
    expect([...occurrences.keys()].sort((a, b) => a - b)).toEqual(records.map((r) => r.seq));
    expect([...occurrences.values()].every((count) => count === 1)).toBe(true);
    expect(CityStateSchema.parse(world.slices.city).macro).toMatchObject({
      processedThrough: 200,
      backlog: false,
      lastAt: T0,
    });
  });

  it("单个旧轮放不下时明确停止，不能截句尾或跳去处理后续", () => {
    const batch = prepare(start(), [
      turn(0, `${"不可省略的因果。".repeat(10_000)}关键结尾`),
      turn(1, "较短的后续"),
    ]);
    expect(batch.kind).toBe("blocked");
  });
});
