import { describe, expect, it } from "vitest";
import { seededRng } from "../kernel/rng";
import type { Command } from "../kernel/system";
import type { WorldState } from "../kernel/world";
import { NpcStateSchema } from "../systems/npc";
import { registry } from "../systems/registry";
import { readOffscreen } from "./offscreen";

// NPC 会移动（用户 2026-11-02："npc是能移动的"，中间人也一样）：场外推演的近况可以带地点
const T0 = 60 * 24 * 10;
const ctx = { rng: seededRng(1) };

const data = {
  locations: [
    { id: "regina-office", name: "瑞吉娜的办公室", district: "沃森", note: "歌舞伎区摩天楼顶层" },
    { id: "afterlife", name: "来生酒吧", district: "沃森", note: "佣兵的老地方" },
  ],
};

function apply(world: WorldState, commands: Command[]) {
  return registry.applyCommands(world, commands, ctx);
}

function start(): WorldState {
  return apply(registry.initialWorld(T0), [
    { type: "jobs.seedFixer", id: "regina", name: "瑞吉娜·琼斯" },
    {
      type: "npc.seed",
      id: "regina",
      name: "瑞吉娜·琼斯",
      pronoun: "她",
      role: "中间人",
      look: "短发，戴眼镜",
      voice: "说话干脆",
      want: "让沃森少点赛博精神病",
      limit: "不害无辜的人",
      home: "regina-office",
      met: true,
    },
  ]).world;
}

const reply = (npcs: unknown[]) => JSON.stringify({ events: [], npcs, messages: [], jobs: [] });

const where = (world: WorldState) => NpcStateSchema.parse(world.slices.npc).npcs.regina?.location;

describe("场外推演里人物移动", () => {
  it("中间人也写近况，带了已有地点就挪过去", () => {
    const world = start();
    expect(where(world)).toBe("regina-office");
    const got = readOffscreen(
      reply([{ id: "regina", doing: "去来生酒吧见一个老客户", location: "afterlife" }]),
      world,
      { data },
    );
    expect(got.commands).toContainEqual({
      type: "doing",
      id: "regina",
      text: "去来生酒吧见一个老客户",
      location: "afterlife",
    });
    const after = apply(world, got.commands);
    expect(after.results.every((r) => r.result.ok)).toBe(true);
    expect(where(after.world)).toBe("afterlife");
  });

  it("地点不在地点表里：近况照收，位置不动", () => {
    const world = start();
    const got = readOffscreen(
      reply([{ id: "regina", doing: "出城办事", location: "made-up-place" }]),
      world,
      { data },
    );
    const doing = got.commands.find((c) => c.type === "doing");
    expect(doing).toEqual({ type: "doing", id: "regina", text: "出城办事" });
    expect(got.notes.some((n) => n.includes("不在地点表里"))).toBe(true);
    const after = apply(world, got.commands);
    expect(where(after.world)).toBe("regina-office");
  });
});
