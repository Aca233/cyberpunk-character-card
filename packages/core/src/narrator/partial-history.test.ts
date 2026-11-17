import { describe, expect, it } from "vitest";
import type { LogRecord, TurnRecord } from "../kernel/turnlog";
import { registry } from "../systems/registry";
import { buildExtractPrompt, buildJudgePrompt, buildNarratorPrompt } from "./prompts";

const opening = "开场专用提示：街边的陌生人第一次敲响车窗。";
const mistaken = "错误正文：已经远程打开保险柜拿走密码。";
const world = registry.initialWorld(1000);
const applied = registry.applyCommands(
  world,
  [{ type: "loot", amount: "some", tier: "street", reason: "朋友还款" }],
  { rng: { roll: () => 1 } },
);
const partial: TurnRecord = {
  kind: "turn",
  seq: 0,
  at: "2077-01-01",
  requestId: "partial",
  baseVersion: 0,
  input: { text: "尝试打开保险柜" },
  text: mistaken,
  commands: applied.results.filter(({ result }) => result.ok).map(({ command }) => command),
  dropped: [],
  dice: [],
  patches: [...applied.patches],
  unsettled: "打开保险柜未成功；独立还款已保留",
  scene: 0,
};

function prompts(records: LogRecord[]) {
  const plan = { kind: "action" as const, input: { text: "看看当前余额" } };
  const extras = { opening, data: { items: [] } };
  return [
    buildJudgePrompt(applied.world, records, plan, extras, []),
    buildNarratorPrompt(applied.world, records, plan, extras),
    buildExtractPrompt(applied.world, records, plan, extras, "你查看了账户余额。"),
  ].map((prompt) => prompt.messages.map((message) => message.content).join("\n"));
}

describe("部分已结算回合的提示词历史", () => {
  it("首轮已有独立事件生效，三个阶段均不重演开场，也不接收失败正文", () => {
    for (const text of prompts([partial])) {
      expect(text).not.toContain(opening);
      expect(text).not.toContain(mistaken);
    }
  });

  it("首轮只有零结算草稿时仍可使用开场，草稿正文不进入历史", () => {
    for (const text of prompts([{ ...partial, draft: true, commands: [], patches: [] }])) {
      expect(text).toContain(opening);
      expect(text).not.toContain(mistaken);
    }
  });

  it("撤回首轮后重新开始，不能被已作废回合永久禁用开场", () => {
    const records: LogRecord[] = [
      partial,
      { kind: "void", seq: 1, at: "2077-01-01", target: 0, reason: "undo" },
    ];
    for (const text of prompts(records)) {
      expect(text).toContain(opening);
      expect(text).not.toContain(mistaken);
    }
  });
});
