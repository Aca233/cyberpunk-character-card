import type { TurnEvent } from "@cp/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FollowHandlers } from "../../api/events";
import { openProgress } from "../../progress";

const mocks = vi.hoisted(() => ({ submit: vi.fn(), stop: vi.fn(), follow: vi.fn() }));
vi.mock("../../api/client", () => ({
  api: { submit: mocks.submit, stop: mocks.stop },
  newRequestId: () => "request",
  ApiError: class extends Error {
    constructor(
      message: string,
      readonly status: number,
      readonly body: Record<string, unknown> = {},
    ) {
      super(message);
    }
  },
}));
vi.mock("../../api/events", () => ({ followTurn: mocks.follow }));

import { ApiError } from "../../api/client";
import { useStory } from "./store";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const refresh = vi.fn(async () => {});
const pending = { kind: "input", input: { text: "走进酒吧" } } as const;
const done = { type: "done", version: 1 } as TurnEvent;
const handlers = () => mocks.follow.mock.calls.at(-1)?.[2] as FollowHandlers;

describe("剧情请求与当前存档隔离", () => {
  beforeEach(() => {
    useStory.getState().enter("reset");
    vi.clearAllMocks();
    mocks.submit.mockResolvedValue({ kind: "started", turnId: "turn-a" });
    mocks.follow.mockReturnValue(vi.fn());
    useStory.getState().enter("save-a");
    useStory.getState().setDraft(pending.input);
  });
  afterEach(() => useStory.getState().enter("cleanup"));

  it("切换存档后，旧提交返回不能订阅旧回合或抢占新存档", async () => {
    const request = deferred<unknown>();
    mocks.submit.mockReturnValueOnce(request.promise);
    const old = useStory.getState().submit("save-a", 0, pending, refresh);
    useStory.getState().enter("save-b");
    await useStory.getState().submit("save-b", 0, pending, refresh);
    request.resolve({ kind: "started", turnId: "stale-turn" });
    await old;
    expect(mocks.follow).toHaveBeenCalledTimes(1);
    expect(useStory.getState()).toMatchObject({ saveId: "save-b", turnId: "turn-a" });
    expect(openProgress()).toHaveLength(1);
  });

  it("切换存档后，旧提交报错不能打断新存档生成", async () => {
    const request = deferred<unknown>();
    mocks.submit.mockReturnValueOnce(request.promise);
    const old = useStory.getState().submit("save-a", 0, pending, refresh);
    useStory.getState().enter("save-b");
    await useStory.getState().submit("save-b", 0, pending, refresh);
    request.reject(new Error("旧请求断网"));
    await old;
    expect(useStory.getState()).toMatchObject({ phase: "streaming", failure: null });
    expect(openProgress()).toHaveLength(1);
  });

  it("旧回合刷新晚到时，不能清空新存档正文和草稿", async () => {
    const loading = deferred<void>();
    await useStory.getState().submit("save-a", 0, pending, () => loading.promise);
    handlers().onEvent(done);
    useStory.getState().enter("save-b");
    useStory.getState().setDraft({ text: "新存档草稿" });
    await useStory.getState().submit("save-b", 0, pending, refresh);
    handlers().onEvent({ type: "text", text: "新存档正文" });
    loading.resolve();
    await loading.promise;
    await Promise.resolve();
    expect(useStory.getState()).toMatchObject({
      phase: "streaming",
      text: "新存档正文",
      draft: { text: "新存档草稿" },
    });
    expect(openProgress()).toHaveLength(1);
  });

  it("取消订阅后排队中的旧流事件也不能写入当前存档", async () => {
    await useStory.getState().submit("save-a", 0, pending, refresh);
    const old = handlers();
    useStory.getState().enter("save-b");
    old.onEvent({ type: "text", text: "旧存档正文" });
    old.onLost("旧连接断开");
    expect(useStory.getState()).toMatchObject({ text: "", failure: null });
  });

  it("生成期间新写的草稿在回合结束后保留", async () => {
    await useStory.getState().submit("save-a", 0, pending, refresh);
    useStory.getState().setDraft({ text: "下一步问老板" });
    handlers().onEvent(done);
    await vi.waitFor(() => expect(useStory.getState().phase).toBe("idle"));
    expect(useStory.getState().draft.text).toBe("下一步问老板");
  });

  it("点选剧情选项不会清空另写的草稿", async () => {
    useStory.getState().setDraft({ text: "另一个行动" });
    await useStory.getState().submit("save-a", 0, pending, refresh);
    handlers().onEvent(done);
    await vi.waitFor(() => expect(useStory.getState().phase).toBe("idle"));
    expect(useStory.getState().draft.text).toBe("另一个行动");
  });

  it("正常发送完成仍清空已发送且未编辑的草稿", async () => {
    await useStory.getState().submit("save-a", 0, pending, refresh);
    handlers().onEvent(done);
    await vi.waitFor(() => expect(useStory.getState().phase).toBe("idle"));
    expect(useStory.getState().draft.text).toBe("");
  });

  it("恢复后端旧回合时，不把刚输入的内容当成旧回合输入", async () => {
    mocks.submit.mockRejectedValueOnce(
      new ApiError("正在生成", 409, { turnId: "old", input: { text: "旧行动" } }),
    );
    await useStory.getState().submit("save-a", 0, pending, refresh);
    handlers().onEvent(done);
    await vi.waitFor(() => expect(useStory.getState().phase).toBe("idle"));
    expect(useStory.getState().draft.text).toBe(pending.input.text);
  });

  it("接管旧回合后失败重试仍使用旧输入，保留未提交的新草稿", async () => {
    const input = { text: "询问维克多的报价" };
    mocks.submit.mockRejectedValueOnce(new ApiError("正在生成", 409, { turnId: "old", input }));
    await useStory.getState().submit("save-a", 0, pending, refresh);
    handlers().onEvent({ type: "stopped" });
    const retry = useStory.getState().pending;
    expect(retry).toEqual({ kind: "input", input });
    expect(useStory.getState().draft.text).toBe(pending.input.text);
    if (!retry) throw new Error("没有恢复可重试的输入");
    await useStory.getState().submit("save-a", 0, retry, refresh);
    expect(mocks.submit.mock.calls.at(-1)?.[1].input).toEqual(input);
  });

  it("接管旧回合的大额确认绑定原行动，不绑定新草稿", async () => {
    const input = { text: "买下那把枪" };
    mocks.submit.mockRejectedValueOnce(new ApiError("正在生成", 409, { turnId: "old", input }));
    await useStory.getState().submit("save-a", 0, pending, refresh);
    handlers().onEvent({ type: "confirmSpend", label: "武器", price: 3000, eddies: 5000 });
    expect(useStory.getState().spend).toMatchObject({ input });
    expect(useStory.getState().draft.text).toBe(pending.input.text);
  });

  it("接管响应缺少合法原输入时明确拒绝，不混用当前草稿", async () => {
    mocks.submit.mockRejectedValueOnce(new ApiError("正在生成", 409, { turnId: "old" }));
    await useStory.getState().submit("save-a", 0, pending, refresh);
    expect(mocks.follow).not.toHaveBeenCalled();
    expect(useStory.getState().failure).toMatchObject({ kind: "rejected", retryable: false });
    expect(useStory.getState().draft.text).toBe(pending.input.text);
  });
});
