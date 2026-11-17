import { applyPatches } from "immer";
import { describe, expect, it } from "vitest";
import { newGameWorld } from "../game";
import type { LlmClient } from "../kernel/ports";
import type { Command } from "../kernel/system";
import type { WorldState } from "../kernel/world";
import { TurnInputSchema } from "../schemas/turn";
import { CyberwareStateSchema } from "../systems/cyberware";
import { EconomyStateSchema } from "../systems/economy";
import { HackingStateSchema } from "../systems/hacking";
import { HealthStateSchema } from "../systems/health";
import { WorldClockStateSchema } from "../systems/world";
import type { EventPlan } from "./event-plan";
import { runNarratorTurn } from "./turn";

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
};
const breach = { type: "breach", network: "保险柜内网", via: "接入点", gains: ["data"] };
const loot = { type: "loot", amount: "some", tier: "street", reason: "到手的钱款" };
const repayment = { ...loot, reason: "朋友归还旧债" };
const event = (id: string, indexes: number[], requires: string[] = []): EventPlan => ({
  id,
  requires,
  entries: indexes.map((index) => `changes[${index}]`),
});

async function run(
  changes: Command[],
  blocked: boolean,
  events: unknown = [
    event(
      "action",
      changes.map((_, i) => i),
    ),
  ],
  options: { sceneEnd?: boolean; messages?: unknown[]; harm?: "none" | "graze" } = {},
) {
  const base = newGameWorld({ startTime: 1000 });
  const world: WorldState = {
    ...base,
    slices: {
      ...base.slices,
      cyberware: {
        ...CyberwareStateSchema.parse(base.slices.cyberware),
        installed: [{ id: "test-deck", slot: "os", installedAt: 0 }],
      },
    },
  };
  const stages: (string | undefined)[] = [];
  const llm: LlmClient = {
    async *stream(request) {
      const stage = request.responseFormat?.name;
      stages.push(stage);
      const value =
        stage === "judge"
          ? {
              read: "尝试接入保险柜",
              ooc: false,
              ruling: {
                kind: blocked ? "blocked" : "possible",
                outcome: blocked ? "保险柜物理隔离，接入失败" : "通过接入点访问保险柜数据",
                reason: blocked ? "没有无线接口，也没有接上数据线" : "已接好数据线并取得授权",
                harm: options.harm ?? "none",
              },
              buy: null,
              recall: [],
              foes: null,
            }
          : stage === "extract"
            ? {
                changes,
                events,
                messages: options.messages,
                sceneEnd: options.sceneEnd,
                choices: [{ text: "使用刚从保险柜里拿到的钥匙" }],
                clutch: true,
                dropped: [],
                sceneMemory: { text: "柜子里的钱已经到手。", anchors: [], resolve: [] },
              }
            : stage === "repair"
              ? null
              : "你访问了保险柜的数据链路，账户中多了一笔钱。";
      yield { type: "text", text: typeof value === "string" ? value : JSON.stringify(value) };
      yield { type: "done", finishReason: "stop" };
    },
  };
  const result = await runNarratorTurn(
    { llm, rng: { roll: () => 1 }, data, offscreen: null },
    world,
    [],
    { kind: "action", input: TurnInputSchema.parse({ text: "接入保险柜，转走其中的钱" }) },
  );
  expect(result.kind).toBe("done");
  if (result.kind !== "done") throw new Error("预期保留正文");
  return { turn: result.turn, world, stages };
}

describe("被规则否决的行动与无法确认归属的收益", () => {
  it.each([false, true])("入侵被拒却同批拿钱时整轮保留零结算草稿，收益在前=%s", async (first) => {
    const { turn, world } = await run(
      [
        ...(first ? [loot, breach] : [breach, loot]),
        { type: "world", activity: "breach", time: 1002 },
      ],
      true,
    );
    expect(turn.draft).toBe(true);
    expect(turn.world).toEqual(world);
    expect(turn.patches).toEqual([]);
    expect(turn.commands).toEqual([]);
    expect(turn.unsettled).toContain("重新生成");
    expect(turn.dropped).toContainEqual(
      expect.objectContaining({ where: "breach", reason: "没有无线接口，也没有接上数据线" }),
    );
    expect(turn.notes.join("\n")).not.toContain("欧元 +150");
  });

  it("成功入侵后领取收益照常生效", async () => {
    const { turn } = await run([breach, loot], false);
    expect(turn.draft).toBeUndefined();
    expect(turn.unsettled).toBeUndefined();
    expect(EconomyStateSchema.parse(turn.world.slices.economy).eddies).toBe(150);
    expect(HackingStateSchema.parse(turn.world.slices.hacking).breachedNetworks).toHaveLength(1);
  });

  it("裁决阻断一次尝试，不妨碍同轮独立收到的合法收益", async () => {
    const { turn } = await run([{ ...loot, reason: "朋友偿还此前的借款" }], true);
    expect(turn.draft).toBeUndefined();
    expect(turn.unsettled).toBeUndefined();
    expect(EconomyStateSchema.parse(turn.world.slices.economy).eddies).toBe(150);
  });

  it("只有被拒入侵也要标出未结算，不把相矛盾的正文写成事实记忆", async () => {
    const { turn, world } = await run([breach], true);
    expect(turn.draft).toBe(true);
    expect(turn.unsettled).toBeDefined();
    expect(turn.world.slices.memory).toEqual(world.slices.memory);
  });

  it("失败接入阻断收益和事后消息，但独立还款保留且不收场", async () => {
    const { turn, world, stages } = await run(
      [breach, loot, repayment],
      true,
      [
        event("access", [0]),
        event("vault-money", [1], ["access"]),
        { id: "notice", requires: ["vault-money"], entries: ["messages[0]"] },
        event("friend-repayment", [2]),
      ],
      { sceneEnd: true, messages: [{ from: "朋友", text: "保险柜钱款已到账。" }] },
    );
    expect(turn.draft).toBeUndefined();
    expect(EconomyStateSchema.parse(turn.world.slices.economy).eddies).toBe(150);
    expect(turn.commands).toEqual([repayment]);
    expect(turn.unsettled).toContain("独立事件已保留");
    expect(turn.world.slices.phone).toEqual(world.slices.phone);
    expect(turn.world.slices.memory).toEqual(world.slices.memory);
    expect(WorldClockStateSchema.parse(turn.world.slices.world).scene).toBe(
      WorldClockStateSchema.parse(world.slices.world).scene,
    );
    expect(applyPatches(world, [...turn.patches])).toEqual(turn.world);
    expect(turn.choices).toEqual([]);
    expect(turn.clutch).toBe(false);
    expect(stages).toHaveLength(3);
  });

  it("省掉入侵指令也不能让依赖主行动成功的收益绕过阻断", async () => {
    const { turn, stages } = await run([loot, repayment], true, [
      event("vault-money", [0], ["$action"]),
      event("repayment", [1]),
    ]);
    expect(EconomyStateSchema.parse(turn.world.slices.economy).eddies).toBe(150);
    expect(turn.commands).toEqual([repayment]);
    expect(turn.unsettled).toBeDefined();
    expect(stages).toHaveLength(3);
  });

  it("成功主行动和依赖收益正常生效", async () => {
    const { turn, stages } = await run([breach, loot], false, [
      event("access", [0], ["$action"]),
      event("money", [1], ["access"]),
    ]);
    expect(turn.unsettled).toBeUndefined();
    expect(EconomyStateSchema.parse(turn.world.slices.economy).eddies).toBe(150);
    expect(HackingStateSchema.parse(turn.world.slices.hacking).breachedNetworks).toHaveLength(1);
    expect(stages).toHaveLength(3);
  });

  it("条目格式错误使本组和后续依赖失败，独立事实仍然落地", async () => {
    const { turn, stages } = await run([{ type: "item", action: "lose" }, loot, repayment], false, [
      event("handoff", [0]),
      event("reward", [1], ["handoff"]),
      event("repayment", [2]),
    ]);
    expect(EconomyStateSchema.parse(turn.world.slices.economy).eddies).toBe(150);
    expect(turn.commands).toEqual([repayment]);
    expect(turn.unsettled).toBeDefined();
    expect(stages.filter((stage) => stage === "repair")).toHaveLength(1);
  });

  it("缺少type的条目不能被忽略后完成同组收益", async () => {
    const { turn } = await run([{} as Command, loot, repayment], false, [
      event("handoff", [0, 1]),
      event("repayment", [2]),
    ]);
    expect(EconomyStateSchema.parse(turn.world.slices.economy).eddies).toBe(150);
    expect(turn.commands).toEqual([repayment]);
  });

  it("被阻断的开战不能误删独立发生的真实受伤", async () => {
    const injury = { type: "damage", tier: "graze", part: "left-arm", reason: "外侧扶手划伤" };
    const { turn } = await run(
      [
        {
          type: "combat",
          action: "start",
          foes: [{ name: "守卫", archetype: "gunner", tier: "street" }],
        },
        injury,
      ],
      true,
      [event("fight", [0], ["$action"]), event("cut", [1])],
      { harm: "graze" },
    );
    expect(turn.draft).toBeUndefined();
    expect(turn.commands).toEqual([injury]);
    expect(HealthStateSchema.parse(turn.world.slices.health).injuries).toHaveLength(1);
  });

  it.each(
    [
      [],
      [event("missing", [0], ["absent"])],
      [event("duplicate", [0]), event("duplicate", [0])],
      [event("first", [1]), event("second", [0])],
    ].map((events) => ({ events })),
  )("事件图不完整时保留零结算草稿，不猜因果也不增加调用：%j", async ({ events }) => {
    const { turn, world, stages } = await run([loot], false, events);
    expect(turn.draft).toBe(true);
    expect(turn.world).toEqual(world);
    expect(turn.patches).toEqual([]);
    expect(stages).toHaveLength(3);
  });
});
