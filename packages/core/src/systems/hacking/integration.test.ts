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
      health: HealthStateSchema.parse(world.slices.health),
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
    ruling: {
      id: "attack-1",
      kind: "costly",
      harm: "heavy",
      reason: "过热程序已侵入神经链",
      ...overrides,
    },
  },
});
const injuries = (world: import("../../kernel/world").WorldState) =>
  HealthStateSchema.parse(world.slices.health).injuries;

describe("NPC 快速破解结算", () => {
  it("原子登记具体神经损伤与消耗，同一事实不重复结算", () => {
    const first = registry.applyCommands(ready(), [attack], context());
    expect(first.results[0]?.result.ok).toBe(true);
    expect(injuries(first.world)).toMatchObject([
      { part: "head", tier: "heavy", treated: false, healsAt: null },
    ]);
    expect(first.world.slices.hacking).toMatchObject({
      npcRamUsed: { runner: 2 },
      resolvedNpcHacks: ["attack-1"],
    });
    const again = registry.applyCommands(first.world, [attack], context());
    expect(again.results[0]?.result.ok).toBe(false);
    expect(again.world).toBe(first.world);
    expect(again.patches).toEqual([]);
  });

  it("harm=none 不按程序类别补成重伤", () => {
    const result = registry.applyCommands(
      ready(),
      [attack],
      context({ harm: "none", kind: "possible" }),
    );
    expect(result.results[0]?.result.ok).toBe(true);
    expect(injuries(result.world)).toEqual([]);
    expect(result.world.slices.hacking).toMatchObject({
      npcRamUsed: { runner: 2 },
      resolvedNpcHacks: ["attack-1"],
    });
  });

  it("只有旧骰子字段时不能制造神经损伤", () => {
    const world = ready();
    const result = registry.applyCommands(world, [attack], {
      rng: fixedRng([]),
      data,
      facts: {
        check: {
          id: "old-check",
          outcome: "failure",
          damage: "lethal",
          npcHack: { id: "runner", program: "overheat" },
        },
      },
    });
    expect(result.results[0]?.result.ok).toBe(false);
    expect(result.world).toBe(world);
    expect(result.patches).toEqual([]);
  });

  it.each([false, true])("自我 ICE 拦截与设备损坏生效：%s", (broken) => {
    const base = ready();
    const world = {
      ...base,
      slices: {
        ...base.slices,
        health: { ...base.slices.health, brokenChrome: broken ? ["self-ice"] : [] },
        cyberware: { installed: [{ id: "self-ice", slot: "frontalCortex", installedAt: 0 }] },
      },
    };
    const first = registry.applyCommands(world, [attack], context());
    expect(first.results[0]?.result.ok).toBe(true);
    expect(injuries(first.world)).toHaveLength(broken ? 1 : 0);
    expect(first.world.slices.hacking).toMatchObject({
      npcRamUsed: { runner: 2 },
      selfIceSpent: !broken,
    });
    const second = registry.applyCommands(first.world, [attack], context({ id: "attack-2" }));
    expect(second.results[0]?.result.ok).toBe(true);
    expect(injuries(second.world)).toHaveLength(broken ? 2 : 1);
  });

  it("伤害连锁失败时消耗与处理记录一并回滚", () => {
    const world = ready();
    world.slices.health.condition = "dead";
    const result = registry.applyCommands(world, [attack], context());
    expect(result.results[0]?.result.ok).toBe(false);
    expect(result.world).toBe(world);
    expect(result.patches).toEqual([]);
    expect(result.world.slices.hacking).toMatchObject({ npcRamUsed: {}, resolvedNpcHacks: [] });
  });

  it("设备运行条件不足时整条拒绝", () => {
    const base = ready();
    const world = {
      ...base,
      slices: {
        ...base.slices,
        hacking: { ...HackingStateSchema.parse(base.slices.hacking), npcRamUsed: { runner: 7 } },
      },
    };
    const result = registry.applyCommands(world, [attack], context());
    expect(result.results[0]?.result.ok).toBe(false);
    expect(result.world).toBe(world);
  });

  it("旧智力门槛不限制有效接入，旧成功骰也不能越过物理气隙", () => {
    const base = ready();
    const world = {
      ...base,
      slices: {
        ...base.slices,
        cyberware: { installed: [{ id: "test-deck", slot: "os", installedAt: 0 }] },
      },
    };
    const breach = {
      type: "breach",
      network: "仓库内网",
      via: "已插线的接入点",
      gains: ["cameras"],
    };
    const applied = registry.applyCommands(world, [breach], {
      rng: fixedRng([]),
      data,
      facts: {
        gate: { attribute: "intelligence", met: false },
        ruling: { id: "access-1", kind: "possible", harm: "none" },
      },
    });
    expect(applied.results[0]?.result.ok).toBe(true);
    const blocked = registry.applyCommands(world, [breach], {
      rng: fixedRng([]),
      data,
      facts: {
        check: { outcome: "success" },
        ruling: { id: "access-2", kind: "blocked", harm: "none", reason: "目标物理气隙隔离" },
      },
    });
    expect(blocked.results[0]?.result).toEqual({ ok: false, reason: "目标物理气隙隔离" });
    expect(blocked.world).toBe(world);
  });
});
