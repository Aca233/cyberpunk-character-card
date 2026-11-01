import { describe, expect, it } from "vitest";
import { type GameContent, newGameWorld } from "./game";
import type { LlmClient, LlmRequest } from "./kernel/ports";
import { JUDGE_TEMPERATURE } from "./narrator/prompts";
import { runNarratorTurn } from "./narrator/turn";
import { TurnInputSchema } from "./schemas/turn";

/**
 * 「全改」第 1 步（用户定的，2026-11-01：模型当主持人，代码只管记账；检定选了 1「先掷再写」）：
 * 判断给了检定时代码当场掷骰，写正文一次写出结果，不再停笔等玩家确认。
 * 用一个假的模型客户端测：判断回一份带检定的 JSON，写正文回一行字，抽取回空账
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

/** 结算要一张物品表；这一轮不碰物品，给空表就够 */
const data: Readonly<Record<string, unknown>> = { items: [] };

const JUDGE_REPLY = JSON.stringify({
  check: {
    intent: "翻过后墙",
    attribute: "reflexes",
    tier: "street",
    edge: "low",
    success: "翻进后院没人发现",
    failure: "落地时踢翻了垃圾桶",
  },
  gate: null,
  buy: null,
  foes: null,
  recall: [],
});

const AUX_REPLY = JSON.stringify({ changes: [], choices: [], dropped: [] });

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
            : "你攀上墙头，一翻身落进了后院。";
      yield { type: "text", text };
      yield { type: "done", finishReason: "stop" };
    },
  };
  return { llm, requests };
}

const textOf = (request: LlmRequest) => request.messages.map((m) => m.content).join("\n");

describe("检定当场掷，不停笔等确认", () => {
  it("判断给了检定：代码当场掷骰，写正文拿到结果，这一轮照常结算", async () => {
    const world = newGameWorld(
      { startTime: 1000, difficulty: "nightCity", opening: "test-open" },
      content,
    );
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
    expect(result.turn.rolled?.offer.label).toBe("翻过后墙");

    const narrate = requests.find(
      (r) => r.purpose === "narrator" && r.temperature !== JUDGE_TEMPERATURE,
    );
    expect(narrate).toBeDefined();
    if (!narrate) return;
    expect(textOf(narrate)).toContain("【检定结果】");
    expect(textOf(narrate)).not.toContain("停笔等玩家确认");
    expect(requests.some((r) => r.purpose === "aux")).toBe(true);
  });
});
