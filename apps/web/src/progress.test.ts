import { afterEach, describe, expect, it, vi } from "vitest";
import { beginProgress, onProgress, openProgress, type ProgressEvent } from "./progress";

/** 进度事件约定（witch-paintbox 借鉴第 2 条，2026-11-02） */
describe("progress", () => {
  const offs: (() => void)[] = [];
  afterEach(() => {
    for (const off of offs.splice(0)) off();
    vi.restoreAllMocks();
  });

  const record = () => {
    const events: ProgressEvent[] = [];
    offs.push(onProgress((e) => events.push(e)));
    return events;
  };

  it("每个开始恰好一个结束：重复结束不再发事件", () => {
    const events = record();
    const p = beginProgress("turn");
    expect(p.end("ok")).toBe(true);
    expect(p.end("error", "又结束一次")).toBe(false);
    expect(events.map((e) => e.type)).toEqual(["start", "end"]);
    expect(openProgress()).toEqual([]);
  });

  it("结束带类别和说明，id 和开始对得上", () => {
    const events = record();
    const p = beginProgress("turn");
    p.end("blocked", "被拦下");
    const [start, end] = events;
    expect(start?.id).toBe(p.id);
    expect(end).toMatchObject({ type: "end", id: p.id, category: "blocked", message: "被拦下" });
  });

  it("没结束的进度能查到", () => {
    const p = beginProgress("turn");
    expect(openProgress()).toContainEqual({ id: p.id, kind: "turn" });
    p.end("aborted");
    expect(openProgress()).not.toContainEqual({ id: p.id, kind: "turn" });
  });

  it("监听出错不影响主流程，也不影响别的监听", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    offs.push(
      onProgress(() => {
        throw new Error("监听坏了");
      }),
    );
    const events = record();
    const p = beginProgress("turn");
    expect(() => p.end("ok")).not.toThrow();
    expect(events.map((e) => e.type)).toEqual(["start", "end"]);
    expect(error).toHaveBeenCalledTimes(2);
  });

  it("取消订阅后收不到", () => {
    const events: ProgressEvent[] = [];
    const off = onProgress((e) => events.push(e));
    off();
    beginProgress("turn").end("ok");
    expect(events).toEqual([]);
  });
});
