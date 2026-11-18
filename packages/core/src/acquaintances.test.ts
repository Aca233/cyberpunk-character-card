import { describe, expect, it } from "vitest";
import { type GameContent, newGameWorld } from "./game";
import { BoardModuleSchema, BoardSchema, boardIssues } from "./schemas/board";
import { acquaintanceSeed, boardStart, CharacterCardSchema } from "./schemas/character";
import { NpcStateSchema } from "./systems/npc/schema";

/**
 * 捏人第 3 步的旧识（用户定的，2026-10-30）：旧识"无数个"，15 个原作人物全部能选、没有预设关系，
 * 模块带出的人也能改关系；关系表定开局好感、附带的关系笔记或人情、花不花背景点
 */

const canon = (id: string, name: string) => ({
  id,
  name,
  pronoun: "她",
  role: "测试人物",
  faction: "none",
  look: "看不清",
  voice: "平平的",
  want: "活下去",
  limit: "不出卖朋友",
  samples: [],
  canon: true,
});

const content: GameContent = {
  npcs: [canon("judy", "朱迪"), canon("rogue", "罗格")],
  openings: [
    {
      id: "test-open",
      title: "测试开场",
      location: "home-bar",
      premise: "从开场酒吧开始。",
      gear: [],
      deadlines: [],
      cast: ["judy"],
    },
  ],
  locations: [{ id: "home-bar", name: "开场酒吧", district: "沃森", x: 20, y: 20 }],
};

const mod = (id: string, slot: "origin" | "past" | "skill", people: { name: string }[] = []) =>
  BoardModuleSchema.parse({ id, slot, label: id, people });

const board = (acquaintances: unknown[]) =>
  BoardSchema.parse({
    origin: mod("street", "origin"),
    pasts: [mod("p1", "past", [{ name: "老韩" }]), mod("p2", "past"), mod("p3", "past")],
    skills: [mod("s1", "skill"), mod("s2", "skill"), mod("s3", "skill")],
    acquaintances,
  });

const card = (acquaintances: unknown[]) =>
  CharacterCardSchema.parse({
    name: "测试",
    origin: "街头",
    attributes: { body: 3, reflexes: 3, tech: 3, intelligence: 3, cool: 3 },
    board: board(acquaintances),
  });

describe("acquaintanceSeed", () => {
  it("老朋友：+30，关系笔记带上是什么事，不记人情", () => {
    expect(
      acquaintanceSeed({ id: "rogue", name: "罗格", relation: "friend", note: "一起扛过事" }),
    ).toEqual({ id: "rogue", affinity: 30, relation: "老朋友：一起扛过事", ledger: [] });
  });

  it("旧仇：−30，记一条 grudge；没写是什么事时用占位", () => {
    const seed = acquaintanceSeed({ id: "rogue", name: "罗格", relation: "grudge", note: "" });
    expect(seed.affinity).toBe(-30);
    expect(seed.relation).toBeUndefined();
    expect(seed.ledger).toHaveLength(1);
    expect(seed.ledger[0]?.kind).toBe("grudge");
  });

  it("点头之交：+5，没写事就什么都不带", () => {
    expect(acquaintanceSeed({ id: "x", name: "X", relation: "nod", note: "" })).toEqual({
      id: "x",
      affinity: 5,
      ledger: [],
    });
  });
});

describe("旧识校验", () => {
  it("同一个人选两次报错", () => {
    const b = board([
      { id: "judy", name: "朱迪", relation: "friend" },
      { id: "judy", name: "朱迪", relation: "ex" },
    ]);
    expect(boardIssues(b)).toContain("旧识「朱迪」选了不止一次");
  });
});

describe("建档带上旧识", () => {
  const start = (acquaintances: unknown[]) => {
    const meta = boardStart(card(acquaintances));
    const world = newGameWorld(
      {
        startTime: 1000,
        opening: "test-open",
        ...(meta ? { board: meta } : {}),
      },
      content,
    );
    return NpcStateSchema.parse(world.slices.npc).npcs;
  };

  it("没选旧识的原作人物照旧：好感 0、没见过", () => {
    const npcs = start([]);
    expect(npcs.judy).toMatchObject({ affinity: 0, met: false, relation: null, ledger: [] });
    expect(npcs.rogue).toBeUndefined();
  });

  it("开场人物里的原作人物按关系盖过开局好感，记成见过", () => {
    const npcs = start([{ id: "judy", name: "朱迪", relation: "ex", note: "分手没吵架" }]);
    expect(npcs.judy).toMatchObject({ affinity: 10, met: true });
    expect(npcs.judy?.relation?.text).toBe("前任：分手没吵架");
  });

  it("不在开场人物里的原作人物选成旧识也会建卡", () => {
    const npcs = start([{ id: "rogue", name: "罗格", relation: "youOwe", note: "她替你挡过一枪" }]);
    expect(npcs.rogue).toMatchObject({ affinity: 10, met: true });
    expect(npcs.rogue?.ledger).toMatchObject([
      { kind: "youOwe", text: "她替你挡过一枪", settledAt: null },
    ]);
  });

  it("模块带出的人改了关系，按关系表覆盖默认好感", () => {
    const id = boardStart(card([]))?.people[0]?.id ?? "";
    const npcs = start([{ id, name: "老韩", relation: "grudge", note: "" }]);
    expect(npcs[id]).toMatchObject({ affinity: -30, met: true });
    expect(npcs[id]?.ledger[0]?.kind).toBe("grudge");
  });
});
