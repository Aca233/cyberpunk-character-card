import { describe, expect, it } from "vitest";
import type { LlmClient } from "../kernel/ports";
import type { TurnRecord } from "../kernel/turnlog";
import { rewriteNarrative } from "./rewrite";

const record: TurnRecord = {
  kind: "turn",
  seq: 0,
  at: "2026-11-16T00:00:00Z",
  requestId: "rewrite-test",
  baseVersion: 0,
  input: { text: "拿走药" },
  text: "你拿走了药。",
  dice: [],
  commands: [],
  patches: [],
  dropped: [],
  unsettled: "物品没有记上",
};
describe("账目改写只能接收完整回复", () => {
  it.each(["length", "MAX_TOKENS", "tool_calls"])("%s 不能清除未定稿标记", async (finishReason) => {
    const llm: LlmClient = {
      async *stream() {
        yield { type: "text", text: "你没拿走药，转身准备" };
        yield { type: "done", finishReason };
      },
    };
    expect(await rewriteNarrative(llm, record)).toMatchObject({
      ok: false,
      error: expect.stringContaining("没有正常结束"),
    });
  });
  it("草稿拒绝调用，已有账目回合正常完成才可改写", async () => {
    let called = 0;
    const llm: LlmClient = {
      async *stream() {
        called++;
        yield { type: "text", text: "药还在柜台上，你没能拿走。" };
        yield { type: "done", finishReason: "stop" };
      },
    };
    expect(await rewriteNarrative(llm, { ...record, draft: true })).toMatchObject({ ok: false });
    expect(called).toBe(0);
    expect(await rewriteNarrative(llm, record)).toMatchObject({ ok: true });
    expect(called).toBe(1);
  });
});
