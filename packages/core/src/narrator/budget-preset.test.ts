import { describe, expect, it } from "vitest";
import { newGameWorld } from "../game";
import type { LlmClient, LlmRequest } from "../kernel/ports";
import type { LogRecord } from "../kernel/turnlog";
import { TurnInputSchema } from "../schemas/turn";
import type { TavernPreset } from "./preset";
import { estimateTokens } from "./prompts/layers";
import { runNarratorTurn } from "./turn";

const records: LogRecord[] = Array.from({ length: 8 }, (_, index) => ({
  kind: "turn",
  seq: index,
  at: "2026-11-16T00:00:00Z",
  requestId: `past-${index}`,
  baseVersion: index,
  input: { text: "继续听他说" },
  dice: [],
  commands: [],
  dropped: [],
  text: `旧事${index}：${"夜".repeat(500)}`,
  patches: [],
  scene: 0,
}));

function preset(head: string, inChat = "", maxOutputTokens = 65_535): TavernPreset {
  return {
    name: "预算验收",
    entries: [
      { id: "head", name: "前置", role: "system", content: head, enabled: true, depth: null },
      { id: "chat", name: "深度", role: "user", content: inChat, enabled: true, depth: 0 },
    ],
    regex: [],
    sampling: { maxOutputTokens },
  };
}

async function run(
  style?: TavernPreset,
  history: readonly LogRecord[] = records,
  maxOutputTokens?: number,
  contextWindow = 32_000,
) {
  const requests: LlmRequest[] = [];
  let rolls = 0;
  const llm: LlmClient = {
    async *stream(request) {
      requests.push(request);
      const text =
        request.responseFormat?.name === "judge"
          ? JSON.stringify({
              read: "你想继续听对方说话",
              ooc: false,
              ruling: null,
              buy: null,
              foes: null,
              recall: [],
              sandevistan: false,
            })
          : request.purpose === "aux"
            ? JSON.stringify({ changes: [], events: [], choices: [], dropped: [] })
            : "杯底碰了一下桌面，对方继续说起刚才的事。";
      yield { type: "text", text };
      yield { type: "done", finishReason: "stop" };
    },
  };
  const result = await runNarratorTurn(
    {
      llm,
      rng: {
        roll: () => {
          rolls += 1;
          return 3;
        },
      },
      contextWindow,
      maxOutputTokens,
      data: { items: [], cyberware: [] },
      offscreen: null,
      preset: style,
    },
    newGameWorld({ startTime: 1000 }),
    history,
    { kind: "action", input: TurnInputSchema.parse({ text: "继续听他说" }) },
  );
  return { result, requests, rolls };
}

describe("最终正文请求的预设预算", () => {
  it("将前置和深度条目计入裁剪与统计，裁剪时不重复展开随机宏", async () => {
    // 预设路径不带本作文风示例，预算对照也从同一路径开始。
    const baseline = await run(preset("简洁叙事"));
    expect(baseline.result.kind).toBe("done");
    if (baseline.result.kind !== "done") return;
    const room = baseline.result.turn.budget.limit - baseline.result.turn.budget.total;
    const extra = room + 1000;
    const style = preset(
      "文".repeat(Math.ceil(extra / 2)),
      `${"风".repeat(Math.floor(extra / 2))}{{roll:d6}}`,
    );
    const { result, requests, rolls } = await run(style);
    expect(result.kind).toBe("done");
    if (result.kind !== "done") return;
    const request = requests.find((r) => r.responseFormat === undefined);
    expect(request).toBeDefined();
    if (!request) return;
    const finalTokens = request.messages.reduce((n, m) => n + estimateTokens(m.content), 0);
    expect(result.turn.budget.total).toBe(finalTokens);
    expect(finalTokens).toBeLessThanOrEqual(result.turn.budget.limit);
    expect(result.turn.budget.history).toBeLessThan(baseline.result.turn.budget.history);
    expect(result.turn.budget.history).toBeGreaterThanOrEqual(3);
    expect(result.turn.budget.parts.find((p) => p.part === "preset")?.tokens).toBeGreaterThan(
      extra,
    );
    expect(request.messages.at(-2)?.content).toBe(`${"风".repeat(Math.floor(extra / 2))}3`);
    expect(request.messages.at(-1)?.content).toContain("【玩家】继续听他说");
    expect(rolls).toBe(1);
    expect(request.maxOutputTokens).toBe(8000);
  });

  it("大上下文窗口允许预设和连接使用更大的输出上限，不再硬顶在 8000", async () => {
    const withPreset = await run(preset("简洁叙事", "", 65_535), [], undefined, 128_000);
    expect(withPreset.result.kind).toBe("done");
    expect(withPreset.requests.find((r) => r.responseFormat === undefined)?.maxOutputTokens).toBe(
      32_000,
    );

    const withProfileCap = await run(undefined, [], 24_000, 128_000);
    expect(withProfileCap.result.kind).toBe("done");
    expect(
      withProfileCap.requests.find((r) => r.responseFormat === undefined)?.maxOutputTokens,
    ).toBe(24_000);

    const defaultLarge = await run(undefined, [], undefined, 128_000);
    expect(defaultLarge.result.kind).toBe("done");
    expect(defaultLarge.requests.find((r) => r.responseFormat === undefined)?.maxOutputTokens).toBe(
      16_000,
    );
  });

  it("尊重预设更小的输出上限，并把相同额度留在窗口里", async () => {
    const { result, requests } = await run(preset("短写", "", 600), []);
    expect(result.kind).toBe("done");
    if (result.kind !== "done") return;
    expect(requests.find((r) => r.responseFormat === undefined)?.maxOutputTokens).toBe(600);
    expect(result.turn.budget.limit).toBe(31_400);
    expect(result.turn.budget.parts.find((p) => p.part === "reply")?.limit).toBe(600);
  });

  it("无法再裁剪时停止，不发送超过预算的正文请求", async () => {
    const { result, requests } = await run(preset("长".repeat(40_000)), []);
    expect(result.kind).toBe("blocked");
    if (result.kind === "blocked") expect(result.reason).toContain("超过本次输入预算");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.responseFormat?.name).toBe("judge");
  });

  it("连接设定的更小输出上限不会被预算或预设覆盖", async () => {
    for (const style of [undefined, preset("简洁叙事")]) {
      const { result, requests } = await run(style, [], 500);
      expect(result.kind).toBe("done");
      if (result.kind !== "done") continue;
      expect(requests.find((r) => r.responseFormat === undefined)?.maxOutputTokens).toBe(500);
      expect(result.turn.budget.limit).toBe(31_500);
      expect(result.turn.budget.parts.find((p) => p.part === "reply")?.limit).toBe(500);
    }
  });

  it("实际正文请求只带预设文风，仍保留玩家权限与世界事实约束", async () => {
    const style = "用简练的书信体，保留人物之间的疏离感。";
    const { result, requests } = await run(preset(style), []);
    expect(result.kind).toBe("done");
    const sent =
      requests
        .find((r) => r.responseFormat === undefined)
        ?.messages.map((m) => m.content)
        .join("\n") ?? "";
    expect(sent.split(style)).toHaveLength(2);
    expect(sent).not.toContain("【默认正文表达】");
    expect(sent).not.toContain("【好坏示例】");
    expect(sent).not.toContain("【最近用过的写法】");
    expect(sent).not.toContain("节律建议");
    expect(sent).not.toContain("用第二人称");
    expect(sent).toContain("信息严格隔离");
    expect(sent).toContain("玩家角色归玩家");
    expect(sent).toContain("账归代码");
    const judge = requests.find((r) => r.responseFormat?.name === "judge");
    expect(judge).toBeDefined();
    const judgment = judge?.messages.map((m) => m.content).join("\n") ?? "";
    expect(judgment).not.toContain("【默认表达】");
    expect(judgment).not.toContain("用第二人称");
  });
});
