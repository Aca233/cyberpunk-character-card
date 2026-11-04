import { describe, expect, it } from "vitest";
import { fixedRng } from "../../kernel/rng";
import { HealthStateSchema } from "../health";
import { NpcSchema } from "../npc";
import { registry } from "../registry";
import { HackingStateSchema } from "./schema";

const attack = {
  type: "npcHack",
  id: "runner",
  program: "overheat",
  target: "你",
};

const data = {
  items: [],
  cyberware: [
    {
      id: "test-deck",
      name: "测试接入仓",
      slot: "os",
      rarity: "common",
      price: 0,
      humanityCost: 0,
      ability: "上传快速破解",
      programSlots: 4,
      ram: 8,
    },
  ],
  quickhacks: [
    {
      id: "overheat",
      name: "过热",
      category: "damage",
      ram: 2,
      effect: "义体过热",
      source: "测试",
    },
  ],
};

function ready(): import("../../kernel/world").WorldState & {
  slices: { health: import("../health").HealthState };
} {
  const world = registry.initialWorld(0);
  return {
    ...world,
    slices: {
      ...world.slices,
      health: { ...HealthStateSchema.parse(world.slices.health), hp: 100, max: 100 },
      npc: {
        npcs: {
          runner: NpcSchema.parse({
            id: "runner",
            name: "黑客",
            pronoun: "TA",
            role: "网络黑客",
            look: "短发",
            voice: "简短",
            want: "完成任务",
            limit: "不出卖同伴",
            affinity: 0,
            alive: true,
            met: true,
            location: null,
            lastSeenAt: null,
            memories: [],
            body: { tier: "mook", gear: [], cyberware: ["test-deck"] },
          }),
        },
      },
    },
  };
}

const context = (overrides: Record<string, unknown> = {}) => ({
  rng: fixedRng([]),
  data,
  facts: {
    check: {
      id: "resist-1",
      outcome: "failure",
      attribute: "intelligence",
      damage: "heavy",
      npcHack: { id: "runner", program: "overheat" },
      ...overrides,
    },
  },
});

describe("NPC 快速破解结算", () => {
  it.each(["failure", "fumble"])("%s 原子扣 RAM 和血，同次检定不重复结算", (outcome) => {
    const first = registry.applyCommands(ready(), [attack], context({ outcome }));
    expect(first.results[0]?.result.ok).toBe(true);
    expect(first.world.slices.health).toMatchObject({ hp: 70, damagedBy: "resist-1" });
    expect(first.world.slices.hacking).toMatchObject({
      npcRamUsed: { runner: 2 },
      resolvedNpcHacks: ["resist-1"],
    });
    const again = registry.applyCommands(first.world, [attack], context({ outcome }));
    expect(again.results[0]?.result.ok).toBe(false);
    expect(again.world).toBe(first.world);
    expect(again.patches).toEqual([]);
  });

  it.each(["success", "critical"])("%s 消耗 RAM 但不扣血", (outcome) => {
    const result = registry.applyCommands(ready(), [attack], context({ outcome }));
    expect(result.results[0]?.result.ok).toBe(true);
    expect(result.world.slices.health).toMatchObject({ hp: 100, damagedBy: null });
    expect(result.world.slices.hacking).toMatchObject({
      npcRamUsed: { runner: 2 },
      resolvedNpcHacks: ["resist-1"],
    });
  });
  it.each([
    { npcHack: undefined },
    { npcHack: { id: "other", program: "overheat" } },
    { npcHack: { id: "runner", program: "short-circuit" } },
    { attribute: "reflexes" },
    { attribute: undefined },
    { damage: undefined },
  ])("抵抗事实不匹配时整条拒绝：%j", (overrides) => {
    const world = ready();
    const result = registry.applyCommands(world, [attack], context(overrides));
    expect(result.results[0]?.result.ok).toBe(false);
    expect(result.world).toBe(world);
    expect(result.patches).toEqual([]);
  });

  it("没有检定时不扣 RAM 或血", () => {
    const world = ready();
    const result = registry.applyCommands(world, [attack], {
      rng: fixedRng([]),
      data,
      facts: {},
    });
    expect(result.results[0]?.result.ok).toBe(false);
    expect(result.world).toBe(world);
    expect(result.patches).toEqual([]);
  });

  it.each([false, true])("自我 ICE 拦截一次，损坏时无效：%s", (broken) => {
    const base = ready();
    const world = {
      ...base,
      slices: {
        ...base.slices,
        health: { ...base.slices.health, brokenChrome: broken ? ["self-ice"] : [] },
        cyberware: {
          installed: [{ id: "self-ice", slot: "frontalCortex", installedAt: 0 }],
        },
      },
    };
    const first = registry.applyCommands(world, [attack], context());
    expect(first.results[0]?.result.ok).toBe(true);
    expect(first.world.slices.health).toMatchObject({ hp: broken ? 70 : 100 });
    expect(first.world.slices.hacking).toMatchObject({
      npcRamUsed: { runner: 2 },
      selfIceSpent: !broken,
      resolvedNpcHacks: ["resist-1"],
    });
    const second = registry.applyCommands(first.world, [attack], context({ id: "resist-2" }));
    expect(second.results[0]?.result.ok).toBe(true);
    expect(second.world.slices.health).toMatchObject({ hp: broken ? 40 : 70 });
  });

  it("伤害连锁失败时 RAM 和抵抗记录一起回滚", () => {
    const world = ready();
    world.slices.health.hp = 0;
    world.slices.health.condition = "down";
    const result = registry.applyCommands(world, [attack], context());
    expect(result.results[0]?.result.ok).toBe(false);
    expect(result.world).toBe(world);
    expect(result.patches).toEqual([]);
    expect(result.world.slices.hacking).toMatchObject({
      npcRamUsed: {},
      resolvedNpcHacks: [],
    });
  });

  it("RAM 不足时不登记抵抗或扣血", () => {
    const base = ready();
    const world = {
      ...base,
      slices: {
        ...base.slices,
        hacking: {
          ...HackingStateSchema.parse(base.slices.hacking),
          npcRamUsed: { runner: 7 },
        },
      },
    };
    const result = registry.applyCommands(world, [attack], context());
    expect(result.results[0]?.result.ok).toBe(false);
    expect(result.world).toBe(world);
    expect(result.patches).toEqual([]);
  });

  it("旧状态补齐抵抗去重记录", () => {
    expect(HackingStateSchema.parse({}).resolvedNpcHacks).toEqual([]);
  });
});
