import { describe, expect, it } from "vitest";
import { readExtractShape } from "./block";
import { type EventPlan, readEventPlan } from "./event-plan";
import { EXTRACT_EXAMPLE } from "./prompts/extract";

const event = (id: string, entries: string[], requires: string[] = []): EventPlan => ({
  id,
  requires,
  entries,
});

describe("抽取事件图", () => {
  it("保留原顺序，把主行动、后续成果与独立还款分别归组", () => {
    const events = [
      event("access", ["changes[0]"], ["$action"]),
      event("proceeds", ["changes[1]", "messages[0]"], ["$action", "access"]),
      event("repayment", ["changes[2]", "messages[1]"]),
    ];
    expect(readEventPlan(events, 3, 2)).toEqual({ ok: true, events });
  });

  it("允许仅消息、同组多条业务指令及显式无事实", () => {
    const messages = [event("incoming", ["messages[0]"])];
    expect(readEventPlan(messages, 0, 1)).toEqual({ ok: true, events: messages });
    const payment = [event("delivery", ["changes[0]", "changes[1]"])];
    expect(readEventPlan(payment, 2, 0)).toEqual({ ok: true, events: payment });
    expect(readEventPlan([], 0, 0)).toEqual({ ok: true, events: [] });
  });

  it.each([
    [undefined, 0, 0],
    [null, 0, 0],
    [{}, 0, 0],
    [[{ id: "partial", entries: ["changes[0]"] }], 1, 0],
    [[{ id: "partial", requires: [] }], 1, 0],
    [[event("empty", [])], 0, 0],
    [[{ ...event("extra", ["changes[0]"]), depend: [] }], 1, 0],
  ])("拒绝不完整或错误的事件格式：%j", (raw, changes, messages) => {
    expect(readEventPlan(raw, changes as number, messages as number).ok).toBe(false);
  });

  it.each(["$action", "$another", "Upper", "中文", "-leading", "spaced id", ""])(
    "事件自身 id 不得为保留值或错误标识：%s",
    (id) => {
      expect(readEventPlan([event(id, ["changes[0]"])], 1, 0).ok).toBe(false);
    },
  );

  it("拒绝重复事件 id 和重复依赖", () => {
    expect(
      readEventPlan([event("same", ["changes[0]"]), event("same", ["changes[1]"])], 2, 0),
    ).toMatchObject({ ok: false, error: expect.stringContaining("id 重复") });
    expect(
      readEventPlan([event("gain", ["changes[0]"], ["$action", "$action"])], 1, 0),
    ).toMatchObject({ ok: false, error: expect.stringContaining("重复依赖") });
  });

  it.each([
    [event("self", ["changes[0]"], ["self"])],
    [event("missing", ["changes[0]"], ["unknown"])],
    [event("later", ["changes[0]"], ["future"]), event("future", ["changes[1]"])],
    [event("cycle-a", ["changes[0]"], ["cycle-b"]), event("cycle-b", ["changes[1]"], ["cycle-a"])],
  ])("拒绝自依赖、缺引用、前向引用及循环：%j", (...events) => {
    expect(readEventPlan(events, events.length, 0).ok).toBe(false);
  });

  it.each([
    "changes[-1]",
    "changes[01]",
    "changes[1.0]",
    "changes[0] ",
    "changes.0",
    "messages[-1]",
    "choices[0]",
    "sceneMemory",
  ])("条目引用不允许模糊写法：%s", (reference) => {
    expect(readEventPlan([event("entry", [reference])], 1, 1).ok).toBe(false);
  });

  it("拒绝越界或超出安全整数的索引", () => {
    for (const reference of ["changes[1]", "messages[1]", "changes[9999999999999999999]"])
      expect(readEventPlan([event("entry", [reference])], 1, 1)).toMatchObject({
        ok: false,
        error: expect.stringContaining("不存在"),
      });
  });

  it("条目不能归属两组，也不能遗漏末尾条目", () => {
    expect(
      readEventPlan([event("one", ["changes[0]"]), event("two", ["changes[0]"])], 1, 0),
    ).toMatchObject({ ok: false, error: expect.stringContaining("重复归属") });
    expect(readEventPlan([event("one", ["changes[0]"])], 2, 0)).toMatchObject({
      ok: false,
      error: expect.stringContaining("changes[1] 没有归属"),
    });
    expect(readEventPlan([event("one", ["changes[0]"])], 1, 1)).toMatchObject({
      ok: false,
      error: expect.stringContaining("messages[0] 没有归属"),
    });
  });

  it.each([
    [event("reverse", ["changes[1]", "changes[0]"])],
    [event("interleaved", ["changes[0]", "changes[2]"]), event("other", ["changes[1]"])],
  ])("不能为成组而改动 changes 顺序：%j", (...events) => {
    const count = events.reduce((total, entry) => total + entry.entries.length, 0);
    expect(readEventPlan(events, count, 0)).toMatchObject({
      ok: false,
      error: expect.stringContaining("原顺序"),
    });
  });

  it("messages 自身保持原顺序，不因 changes 合法就接受消息倒序", () => {
    expect(
      readEventPlan(
        [event("first", ["changes[0]", "messages[1]"]), event("next", ["messages[0]"])],
        1,
        2,
      ),
    ).toMatchObject({ ok: false, error: expect.stringContaining("原顺序") });
  });

  it("不修补不合法的数量边界", () => {
    for (const count of [-1, 1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(readEventPlan([], count, 0).ok).toBe(false);
      expect(readEventPlan([], 0, count).ok).toBe(false);
    }
  });
});

describe("抽取协议接线", () => {
  it("不支持缺少 events 的旧抽取，事件内容交给独立图校验处理", () => {
    expect(readExtractShape({ changes: [] })).toMatchObject({
      ok: false,
      error: expect.stringContaining("events"),
    });
    const shape = readExtractShape({ changes: [], events: null });
    expect(shape).toEqual({ ok: true, extract: { changes: [], events: null } });
    if (shape.ok) expect(readEventPlan(shape.extract.events, 0, 0).ok).toBe(false);
  });

  it("模型示例符合正式事件协议", () => {
    const example = JSON.parse(EXTRACT_EXAMPLE);
    const shape = readExtractShape(example);
    expect(shape.ok).toBe(true);
    if (!shape.ok) return;
    expect(readEventPlan(shape.extract.events, shape.extract.changes?.length ?? 0, 0).ok).toBe(
      true,
    );
  });
});
