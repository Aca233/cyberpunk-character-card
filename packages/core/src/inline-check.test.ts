import { describe, expect, it } from "vitest";
import { type GameContent, newGameWorld } from "./game";
import type { LlmClient, LlmRequest } from "./kernel/ports";
import { JUDGE_TEMPERATURE } from "./narrator/prompts";
import { runNarratorTurn } from "./narrator/turn";
import { TurnInputSchema } from "./schemas/turn";

/**
 * 零掷骰定性因果测试：
 * ① 判断使用原生 JSON Schema（ruling），不再产出或掷任何检定骰；
 * ② 定性裁决结果写进【本轮已定的事】和 ctx.facts.ruling；
 * ③ 抽取使用纯 JSON 模式（responseFormat: { type: "json", name: "extract" }），且不再发起额外质检调用。
 */
const content: GameContent = {
  locations: [{ id: "home-bar", name: "开场酒吧", district: "沃森", x: 20, y: 20 }],
  openings: [
    {
      id: "test-open",
      title: "测试开场",
      location: "home-bar",
      premise: "从开场酒吧开始。",
      gear: [],
      deadlines: [],
    },
  ],
};

const data: Readonly<Record<string, unknown>> = { items: [] };

const JUDGE_REPLY = JSON.stringify({
  read: "你想趁夜翻过布满碎铁皮的后墙潜入院子",
  ooc: false,
  ruling: {
    kind: "costly",
    outcome: "翻上去了，但铁皮晃动割破了掌心，落地声也引来了屋檐下的目光",
    harm: "graze",
    reason: "墙头铁皮年久松动，且没有夜视或隔音义体掩护",
  },
  buy: null,
  foes: null,
  recall: [],
});

const AUX_REPLY = JSON.stringify({
  changes: [{ type: "damage", tier: "graze", reason: "墙头铁皮划伤掌心" }],
  choices: [],
  dropped: [],
});

function fakeLlm() {
  const requests: LlmRequest[] = [];
  const llm: LlmClient = {
    async *stream(request) {
      requests.push(request);
      const text =
        request.purpose === "aux"
          ? AUX_REPLY
          : request.temperature === JUDGE_TEMPERATURE
            ? JUDGE_REPLY
            : "你蹬着潮湿的砖墙翻上去，生锈铁皮在掌心撕开一道血口。";
      yield { type: "text", text };
      yield { type: "done", finishReason: "stop" };
    },
  };
  return { llm, requests };
}

const textOf = (request: LlmRequest) => request.messages.map((m) => m.content).join("\n");

describe("零掷骰定性裁决与原生 JSON 约束", () => {
  it("判断输出定性裁决且不掷骰，写正文拿到客观后果并一次结算，不跑额外质检", async () => {
    const world = newGameWorld({ startTime: 1000, opening: "test-open" }, content);
    const { llm, requests } = fakeLlm();
    const result = await runNarratorTurn(
      { llm, rng: { roll: () => 6 }, offscreen: null, data },
      world,
      [],
      { kind: "action", input: TurnInputSchema.parse({ text: "我翻墙进去" }) },
    );
    expect(result.kind).toBe("done");
    if (result.kind !== "done") return;
    expect(result.turn.check).toBeUndefined();
    expect(result.turn.rolled).toBeUndefined();
    expect(result.turn.gate).toBeUndefined();
    expect(result.turn.closeup).toBeUndefined();
    expect(result.turn.ruling).toContain("铁皮");

    // 本轮共 3 次调用：judge、narrate、extract（已退休 verify）
    expect(requests).toHaveLength(3);
    const judge = requests[0];
    const narrate = requests[1];
    const extract = requests[2];
    expect(judge?.responseFormat?.type).toBe("json");
    expect(judge?.responseFormat?.name).toBe("judge");
    expect(judge?.responseFormat?.schema).toBeDefined();
    expect(extract?.responseFormat).toEqual({ type: "json", name: "extract" });

    expect(narrate).toBeDefined();
    if (narrate) {
      const prompt = textOf(narrate);
      expect(prompt).toContain("【条件与代价】");
      expect(prompt).not.toContain("【检定结果】");
      expect(prompt).not.toContain("2d6");
    }
    expect(result.turn.commands).toContainEqual({
      type: "damage",
      tier: "graze",
      reason: "墙头铁皮划伤掌心",
    });
  });
});
