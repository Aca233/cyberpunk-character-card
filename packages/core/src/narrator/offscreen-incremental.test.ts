import { describe, expect, it } from "vitest";
import { seededRng } from "../kernel/rng";
import type { Command } from "../kernel/system";
import { replay, type TurnRecord } from "../kernel/turnlog";
import type { WorldState } from "../kernel/world";
import { CityStateSchema } from "../systems/city";
import { registry } from "../systems/registry";
import { buildOffscreenPrompt, lifePicks, offscreenDue, readOffscreen } from "./offscreen";

const ctx = { rng: seededRng(2) };
const T0 = 1000;
const empty = { events: [], npcs: [], messages: [] };
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
function prompt(world: WorldState, records: TurnRecord[] = [], text = "这轮没有新动作") {
  return (
    buildOffscreenPrompt(world, records, { data: { items: [], cyberware: [] } }, text)[1]
      ?.content ?? ""
  );
}

describe("场外推演成功游标和失败退避", () => {
  it("失败不覆盖成功范围，退避期间即使有期限到期也不重试", () => {
    const previous = apply(start(), [{ type: "city.ran", through: 5 }]).world;
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
    const result = apply(world, [{ type: "city.ran", through: 7 }]);
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

describe("场外推演批次完整性", () => {
  it("只有明确的空结果才算成功，拒答、缺字段和数组格式错都失败", () => {
    expect(readOffscreen(JSON.stringify(empty), start()).ok).toBe(true);
    for (const value of [
      "拒绝输出",
      "{}",
      "null",
      JSON.stringify({ ...empty, events: null }),
      JSON.stringify({ ...empty, threads: {} }),
    ]) {
      expect(readOffscreen(value, start()).ok).toBe(false);
    }
  });

  it("部分条目无效时保留诊断但整批标为失败，不把合法部分当作成功", () => {
    const got = readOffscreen(
      JSON.stringify({
        ...empty,
        events: [
          {
            id: "power-cut",
            title: "断电",
            body: "变电站故障",
            status: "brewing",
            weight: "normal",
          },
          { id: "broken" },
        ],
      }),
      start(),
    );
    expect(got.commands.some((c) => c.type === "city.event")).toBe(true);
    expect(got.ok).toBe(false);
  });

  it("遗漏轮换生活建议不是失败，重复的近况则是无效批次", () => {
    const world = seed(start(), "n-one", "甲");
    expect(readOffscreen(JSON.stringify(empty), world).ok).toBe(true);
    const got = readOffscreen(
      JSON.stringify({
        ...empty,
        npcs: [
          { id: "n-one", doing: "修发动机" },
          { id: "n-one", doing: "喝咖啡" },
        ],
      }),
      world,
    );
    expect(got.ok).toBe(false);
  });
});

describe("场外推演增量材料", () => {
  it("按成功 seq 选正文，同一分钟的新行动保留；不带旧轮、出戏和未定稿", () => {
    const world = apply(start(), [{ type: "city.ran", through: 2 }]).world;
    const text = prompt(world, [
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

  it("积压超过八轮、每轮超过六百字也保留因果结尾", () => {
    const text = prompt(
      start(),
      Array.from({ length: 10 }, (_, i) => turn(i, `${"长叙事".repeat(220)}因果结尾${i}。`)),
    );
    for (let i = 0; i < 10; i += 1) expect(text).toContain(`因果结尾${i}。`);
  });

  it("相关人物超过十二名仍带详卡，远端轮换者和完整索引仍在", () => {
    let world = start();
    for (let i = 0; i < 18; i += 1)
      world = seed(world, `npc-${String(i).padStart(2, "0")}`, `工友${i}号`);
    const text = prompt(
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

  it("到期心事主人即使不在近期正文也带动机、公开说法与期限", () => {
    const world = seed(start(), "absent", "离场者");
    const active = {
      ...world,
      slices: {
        ...world.slices,
        threads: {
          closed: [],
          threads: [
            {
              id: "leave-city",
              kind: "concern",
              owner: "absent",
              seed: null,
              title: "离城",
              want: "把母亲接走",
              stage: "已买票",
              openedAt: 900,
              dueAt: 999,
              reminded: false,
              steps: [
                {
                  at: 950,
                  kind: "move",
                  text: "私下买了船票",
                  news: "去码头办事",
                  turf: null,
                  told: false,
                },
              ],
            },
          ],
        },
      },
    };
    const text = prompt(active);
    expect(text).toContain("想要：离场者独有诉求");
    expect(text).toContain("公开说法：去码头办事（玩家还没听说）");
    expect(text).toContain("已到点");
  });
});
