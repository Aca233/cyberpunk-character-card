import { describe, expect, it } from "vitest";
import { newGameWorld } from "../game";
import type { LlmClient } from "../kernel/ports";
import type { Command } from "../kernel/system";
import type { WorldState } from "../kernel/world";
import { TurnInputSchema } from "../schemas/turn";
import { CyberwareStateSchema } from "../systems/cyberware";
import { EconomyStateSchema } from "../systems/economy";
import { HackingStateSchema } from "../systems/hacking";
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

async function run(changes: Command[], blocked: boolean) {
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
  const llm: LlmClient = {
    async *stream(request) {
      const stage = request.responseFormat?.name;
      const value =
        stage === "judge"
          ? {
              read: "尝试接入保险柜",
              ooc: false,
              ruling: {
                kind: blocked ? "blocked" : "possible",
                outcome: blocked ? "保险柜物理隔离，接入失败" : "通过接入点访问保险柜数据",
                reason: blocked ? "没有无线接口，也没有接上数据线" : "已接好数据线并取得授权",
                harm: "none",
              },
              buy: null,
              recall: [],
              foes: null,
            }
          : stage === "extract"
            ? {
                changes,
                choices: [],
                dropped: [],
                sceneMemory: { text: "柜子里的钱已经到手。", anchors: [], resolve: [] },
              }
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
  return { turn: result.turn, world };
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
    expect(turn.unsettled).toContain("入侵");
    expect(turn.world.slices.memory).toEqual(world.slices.memory);
  });
});
