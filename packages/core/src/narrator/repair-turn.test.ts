import { describe, expect, it } from "vitest";
import { newGameWorld } from "../game";
import type { LlmClient, LlmRequest } from "../kernel/ports";
import { TurnInputSchema } from "../schemas/turn";
import { HealthStateSchema } from "../systems/health";
import { runNarratorTurn } from "./turn";

const judge = {
  read: "你想检查门锁",
  ooc: false,
  ruling: {
    kind: "costly",
    outcome: "门框毛刺划伤左手",
    harm: "graze",
    reason: "手伸进变形的金属门框",
  },
  buy: null,
  recall: [],
  foes: null,
};
const injury = { type: "damage", tier: "graze", reason: "门框划伤左手", part: "left-arm" };

async function run(replies: {
  judge?: unknown;
  extract?: unknown;
  repair?: (request: LlmRequest) => unknown;
}) {
  const requests: LlmRequest[] = [];
  const world = newGameWorld({ startTime: 1000 });
  const llm: LlmClient = {
    async *stream(request) {
      requests.push(request);
      const stage = request.responseFormat?.name;
      const value =
        stage === "judge"
          ? (replies.judge ?? judge)
          : stage === "extract"
            ? (replies.extract ?? { changes: [], choices: [], dropped: [] })
            : stage === "repair"
              ? replies.repair?.(request)
              : "门框划破左手，你花了两分钟看清锁舌的形状。";
      yield {
        type: "text",
        text: typeof value === "string" ? value : JSON.stringify(value ?? null),
      };
      yield { type: "done", finishReason: "stop" };
    },
  };
  const result = await runNarratorTurn(
    { llm, rng: { roll: () => 1 }, data: { items: [] }, offscreen: null },
    world,
    [],
    { kind: "action", input: TurnInputSchema.parse({ text: "检查门锁" }) },
  );
  return { result, requests, world };
}

describe("回合修复请求有界且账目可核对", () => {
  it.each([{}, { ...judge, ooc: "false" }, { ooc: false, ruling: null }])(
    "判断缺失关键字段时不能用修复空对象绕过停止：%j",
    async (invalid) => {
      const { result, requests } = await run({ judge: invalid, repair: () => ({}) });
      expect(result.kind).toBe("blocked");
      expect(requests.map((r) => r.responseFormat?.name)).toEqual(["judge", "repair"]);
    },
  );

  it("显式无裁决、无交易的日常判断仍可直接写正文", async () => {
    const { result, requests } = await run({ judge: { ...judge, ruling: null, buy: null } });
    expect(result.kind).toBe("done");
    expect(requests).toHaveLength(3);
  });

  it.each([{}, { fixes: [] }, "无效抽取"])(
    "抽取缺少changes且修复为空时，保留未结算标记：%j",
    async (invalid) => {
      const { result, requests, world } = await run({ extract: invalid, repair: () => ({}) });
      expect(result.kind).toBe("done");
      if (result.kind !== "done") return;
      expect(result.turn.unsettled).toBeDefined();
      expect(result.turn.world.time).toBe(world.time);
      expect(requests.filter((r) => r.responseFormat?.name === "repair")).toHaveLength(1);
    },
  );

  it("多条错误合为一次修复，可选建议不占修复额度", async () => {
    const { result, requests } = await run({
      extract: {
        changes: [
          { ...injury, tier: "scratched" },
          { type: "world", activity: "observe", time: "invalid" },
        ],
        choices: [{ text: "" }],
        dropped: [],
      },
      repair: (request) => {
        expect(request.messages.at(-1)?.content).not.toContain("choices[0]");
        return {
          fixes: [
            { key: "changes[0]", value: injury },
            { key: "changes[1]", value: { type: "world", activity: "observe", time: 1002 } },
          ],
        };
      },
    });
    expect(requests.filter((r) => r.responseFormat?.name === "repair")).toHaveLength(1);
    expect(result.kind).toBe("done");
    if (result.kind !== "done") return;
    expect(result.turn.repairs).toBe(1);
    expect(result.turn.unsettled).toBeUndefined();
    expect(result.turn.world.time).toBe(1002);
    expect(HealthStateSchema.parse(result.turn.world.slices.health).injuries).toHaveLength(1);
    expect(result.turn.choices).toEqual([]);
  });

  it("合法抽取不含额外修复调用", async () => {
    const { result, requests } = await run({
      extract: { changes: [injury], choices: [{ text: "" }], dropped: [] },
    });
    expect(result.kind).toBe("done");
    expect(requests).toHaveLength(3);
  });

  it("顶层修复耗尽本阶段额度后，不为每条坏账再次调用，标为未完整结算", async () => {
    const { result, requests, world } = await run({
      extract: "无法解析的抽取",
      repair: () => ({
        changes: [
          { ...injury, tier: "scratched" },
          { type: "world", activity: "observe", time: "invalid" },
        ],
        choices: [],
        dropped: [],
      }),
    });
    expect(requests.filter((r) => r.responseFormat?.name === "repair")).toHaveLength(1);
    expect(result.kind).toBe("done");
    if (result.kind !== "done") return;
    expect(result.turn.unsettled).toBeDefined();
    expect(result.turn.world.time).toBe(world.time);
    expect(result.turn.world.slices.health).toEqual(world.slices.health);
    expect(result.turn.dropped.filter((d) => d.where.startsWith("changes["))).toHaveLength(2);
  });

  it("行动裁决和交易格式共同修一次，失败就停止，不能默认为可行", async () => {
    const { result, requests } = await run({
      judge: { ...judge, ruling: { kind: "wrong" }, buy: { service: "wrong" } },
      repair: () => ({ fixes: [] }),
    });
    expect(result.kind).toBe("blocked");
    expect(requests.map((r) => r.responseFormat?.name)).toEqual(["judge", "repair"]);
  });

  it("判断与抽取各修一批，整轮最多两次，失败的非伤害事实也保留未结算标记", async () => {
    const { result, requests } = await run({
      judge: { ...judge, ruling: { kind: "possible" } },
      extract: {
        changes: [{ type: "npcGear", action: "give" }],
        choices: [],
        dropped: [],
      },
      repair: (request) =>
        request.messages.at(-1)?.content.includes('"key":"ruling"')
          ? {
              fixes: [
                {
                  key: "ruling",
                  value: {
                    kind: "possible",
                    outcome: "可以观察门锁",
                    harm: "none",
                    reason: "锁在眼前",
                  },
                },
              ],
            }
          : { fixes: [] },
    });
    const repairs = requests.filter((r) => r.responseFormat?.name === "repair");
    expect(repairs).toHaveLength(2);
    expect(repairs.every((r) => r.maxOutputTokens === 2048)).toBe(true);
    expect(result.kind).toBe("done");
    if (result.kind !== "done") return;
    expect(result.turn.unsettled).toBeDefined();
  });
});
