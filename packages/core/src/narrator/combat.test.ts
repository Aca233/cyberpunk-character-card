import { describe, expect, it } from "vitest";
import { newGameWorld } from "../game";
import type { LlmClient } from "../kernel/ports";
import type { Command } from "../kernel/system";
import type { WorldState } from "../kernel/world";
import { TurnInputSchema } from "../schemas/turn";
import { CombatStateSchema } from "../systems/combat/schema";
import { HackingStateSchema } from "../systems/hacking/schema";
import { HealthStateSchema } from "../systems/health/schema";
import { NpcSchema } from "../systems/npc/schema";
import { JUDGE_TEMPERATURE, VERIFY_TEMPERATURE } from "./prompts";
import { runNarratorTurn } from "./turn";

function ready() {
  const world = newGameWorld(
    { startTime: 1000, difficulty: "nightCity", opening: "test-open" },
    {
      locations: [{ id: "home-bar", name: "酒吧", district: "沃森", x: 20, y: 20 }],
      openings: [
        {
          id: "test-open",
          title: "测试",
          location: "home-bar",
          premise: "从酒吧开始。",
          gear: [],
          deadlines: [],
        },
      ],
    },
  );
  return {
    ...world,
    slices: {
      ...world.slices,
      health: { ...HealthStateSchema.parse(world.slices.health), hp: 100, max: 100 },
    },
  };
}

const hackData = {
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

function withRunner(): import("../kernel/world").WorldState {
  const world = ready();
  return {
    ...world,
    slices: {
      ...world.slices,
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
            location: "home-bar",
            lastSeenAt: 1000,
            memories: [],
            body: { tier: "mook", gear: [], cyberware: ["test-deck"] },
          }),
        },
      },
    },
  };
}

const start: Command = {
  type: "combat",
  action: "start",
  foes: [{ name: "枪手", archetype: "gunner", tier: "street" }],
};
const wound: Command = {
  type: "combat",
  action: "wound",
  by: "foe1",
  weapon: "霰弹枪",
  part: "left-arm",
  tier: "heavy",
};
const damage: Command = { type: "damage", tier: "heavy", reason: "同一次霰弹命中" };

describe("叙事战斗伤害去重", () => {
  it("自我 ICE 拦截后不被附带伤害或伤口重复扣血", async () => {
    const base = withRunner();
    const world: WorldState = {
      ...base,
      slices: {
        ...base.slices,
        cyberware: { installed: [{ id: "self-ice", slot: "frontalCortex", installedAt: 0 }] },
      },
    };
    const attack = { type: "npcHack", id: "runner", program: "overheat", target: "你" };
    const result = await runNarratorTurn(
      {
        llm: fakeLlm([damage, attack, wound], {
          intent: "抵抗过热",
          attribute: "body",
          tier: "elite",
          edge: "high",
          success: "挡住",
          failure: "过热受伤",
          damage: "heavy",
          npcHack: { id: "runner", program: "overheat" },
        }),
        rng: { roll: () => 2 },
        offscreen: null,
        data: hackData,
      },
      world,
      [],
      { kind: "action", input: TurnInputSchema.parse({ text: "抵抗破解" }) },
    );
    expect(result.kind).toBe("done");
    if (result.kind !== "done") return;
    expect(result.turn.world.slices.health).toEqual(world.slices.health);
    expect(result.turn.world.slices.hacking).toMatchObject({
      selfIceSpent: true,
      npcRamUsed: { runner: 2 },
      resolvedNpcHacks: ["inline.0"],
    });
    expect(CombatStateSchema.parse(result.turn.world.slices.combat).wounds).toEqual([]);
    expect(result.turn.commands).toContainEqual(attack);
  });
  it("RAM 不足时独立伤害和伤口不能绕过破解校验", async () => {
    const base = withRunner();
    const world: WorldState = {
      ...base,
      slices: {
        ...base.slices,
        hacking: { ...HackingStateSchema.parse(base.slices.hacking), npcRamUsed: { runner: 8 } },
      },
    };
    const attack = { type: "npcHack", id: "runner", program: "overheat", target: "你" };
    const result = await runNarratorTurn(
      {
        llm: fakeLlm([damage, attack, wound], {
          intent: "抵抗过热",
          attribute: "intelligence",
          tier: "elite",
          edge: "high",
          success: "挡住",
          failure: "过热受伤",
          damage: "heavy",
          npcHack: { id: "runner", program: "overheat" },
        }),
        rng: { roll: () => 2 },
        offscreen: null,
        data: hackData,
      },
      world,
      [],
      { kind: "action", input: TurnInputSchema.parse({ text: "抵抗破解" }) },
    );
    expect(result.kind).toBe("done");
    if (result.kind !== "done") return;
    expect(result.turn.world.slices.health).toEqual(world.slices.health);
    expect(result.turn.world.slices.hacking).toEqual(world.slices.hacking);
    expect(CombatStateSchema.parse(result.turn.world.slices.combat).wounds).toEqual([]);
    expect(result.turn.commands).not.toContainEqual(attack);
  });
  it("快速破解统一扣血，丢弃重复伤害和伤口", async () => {
    const attack = { type: "npcHack", id: "runner", program: "overheat", target: "你" };
    const result = await runNarratorTurn(
      {
        llm: fakeLlm([start, damage, attack, wound], {
          intent: "抵抗过热",
          attribute: "intelligence",
          tier: "elite",
          edge: "high",
          success: "挡住程序",
          failure: "过热受伤",
          damage: "heavy",
          npcHack: { id: "runner", program: "overheat" },
        }),
        rng: { roll: () => 2 },
        offscreen: null,
        data: hackData,
      },
      withRunner(),
      [],
      { kind: "action", input: TurnInputSchema.parse({ text: "我抵抗快速破解" }) },
    );
    expect(result.kind).toBe("done");
    if (result.kind !== "done") return;
    expect(result.turn.world.slices.health).toMatchObject({ hp: 70 });
    expect(CombatStateSchema.parse(result.turn.world.slices.combat).wounds).toEqual([]);
    expect(HackingStateSchema.parse(result.turn.world.slices.hacking).npcRamUsed).toEqual({
      runner: 2,
    });
    expect(result.turn.commands).toContainEqual(attack);
    expect(result.turn.dropped).toHaveLength(2);
  });
  it.each([
    [start, wound, damage],
    [damage, start, wound],
    [wound, damage, start],
  ])("同批开战不因指令顺序重复扣血：%j", async (...changes) => {
    const result = await runNarratorTurn(
      {
        llm: fakeLlm(changes, {
          intent: "躲开霰弹",
          attribute: "reflexes",
          tier: "elite",
          edge: "high",
          success: "躲开",
          failure: "左臂中弹",
          damage: "heavy",
        }),
        rng: { roll: () => 2 },
        offscreen: null,
        data: { items: [] },
      },
      ready(),
      [],
      { kind: "action", input: TurnInputSchema.parse({ text: "我躲开枪口" }) },
    );
    expect(result.kind).toBe("done");
    if (result.kind !== "done") return;
    expect(result.turn.world.slices.health).toMatchObject({ hp: 70 });
    expect(CombatStateSchema.parse(result.turn.world.slices.combat).wounds).toHaveLength(1);
    expect(result.turn.commands.some((c) => c.type === "damage")).toBe(false);
    expect(result.turn.dropped.some((d) => (d.raw as Command | null)?.type === "damage")).toBe(
      true,
    );
  });
});

function fakeLlm(changes: Command[], check: unknown = null): LlmClient {
  return {
    async *stream(request) {
      const text =
        request.purpose === "aux"
          ? request.temperature === VERIFY_TEMPERATURE
            ? `<patch>\n${changes.map((_, i) => `keep ${i + 1}`).join("\n")}\n</patch>`
            : JSON.stringify({ changes, choices: [], dropped: [] })
          : request.temperature === JUDGE_TEMPERATURE
            ? JSON.stringify({ check, gate: null, buy: null, foes: null, recall: [] })
            : "枪手开火，你的左臂被霰弹擦过，留下了一处伤口。";
      yield { type: "text", text };
      yield { type: "done", finishReason: "stop" };
    },
  };
}
