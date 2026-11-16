import { describe, expect, it } from "vitest";
import { newGameWorld } from "../game";
import type { LlmClient, LlmRequest } from "../kernel/ports";
import { type LogRecord, replay, type TurnRecord } from "../kernel/turnlog";
import type { WorldState } from "../kernel/world";
import { TurnInputSchema } from "../schemas/turn";
import { CityStateSchema } from "../systems/city";
import { ThreadsStateSchema } from "../systems/threads";
import { estimateTokens } from "./prompts/layers";
import { buildNarratorPrompt } from "./prompts/narrate";
import { NarratorAbortedError, type NarratorTurn, runNarratorTurn } from "./turn";

const prose = "你在柜台上找到了那枚带蓝色刻痕的钥匙，门后的脚步声突然停了。";
const plan = { kind: "action", input: TurnInputSchema.parse({ text: "检查柜台" }) } as const;
const judge = { read: "检查柜台", ooc: false, ruling: null, buy: null, recall: [] };

async function run(
  options: {
    world?: WorldState;
    records?: LogRecord[];
    finish?: string;
    missingDone?: boolean;
    disconnect?: "narrate" | "extract" | "repair";
    cancel?: boolean;
    empty?: boolean;
    extract?: unknown;
    auxWindow?: number;
  } = {},
) {
  const world = options.world ?? newGameWorld({ startTime: 1000 });
  const requests: LlmRequest[] = [];
  const signal = { aborted: false, addEventListener() {} };
  const llm: LlmClient = {
    async *stream(request) {
      requests.push(request);
      const stage = request.responseFormat?.name ?? "narrate";
      const value =
        stage === "judge"
          ? judge
          : stage === "narrate"
            ? prose
            : stage === "extract"
              ? (options.extract ?? {
                  changes: [{ type: "world", activity: "observe", time: world.time + 1 }],
                  sceneEnd: true,
                  sceneMemory: { text: "你检查了柜台。", anchors: [], resolve: [] },
                  summary: {
                    title: "检查柜台",
                    text: "你检查了柜台，发现带蓝色刻痕的钥匙，门后传来的脚步声停了。",
                    people: [],
                    importance: "normal",
                    keywords: ["柜台", "钥匙"],
                  },
                })
              : stage === "offscreen"
                ? { events: [], npcs: [], messages: [] }
                : { fixes: [] };
      if (!(options.empty && stage === "narrate"))
        yield { type: "text", text: typeof value === "string" ? value : JSON.stringify(value) };
      if (stage === options.disconnect) {
        signal.aborted = options.cancel ?? false;
        throw new Error("上游连接中断");
      }
      if (stage === "narrate" && options.missingDone) return;
      yield {
        type: "done",
        finishReason: stage === "narrate" ? (options.finish ?? "stop") : "stop",
      };
    },
  };
  const result = await runNarratorTurn(
    {
      llm,
      rng: { roll: () => 1 },
      data: { items: [] },
      offscreen: 1,
      signal,
      contextWindow: 64_000,
      auxContextWindow: options.auxWindow ?? 32_000,
      auxMaxOutputTokens: 1000,
    },
    world,
    options.records ?? [],
    plan,
  );
  expect(result.kind).toBe("done");
  if (result.kind !== "done") throw new Error("没有可保存的回合");
  return { turn: result.turn, requests, world };
}

function record(turn: NarratorTurn, seq = 0): TurnRecord {
  return {
    kind: "turn",
    seq,
    at: "2026-11-16T00:00:00Z",
    requestId: `draft-${seq}`,
    baseVersion: seq,
    input: plan.input,
    dice: [],
    commands: [...turn.commands],
    dropped: [...turn.dropped],
    text: turn.text,
    patches: [...turn.patches],
    scene: turn.scene,
    unsettled: turn.unsettled,
  };
}

describe("正文草稿与真实状态分开保存", () => {
  it.each(["length", "MAX_TOKENS", "tool_calls"])(
    "结束原因 %s 不能当成完整正文结算",
    async (finish) => {
      const { turn, requests, world } = await run({ finish });
      expect(turn.text).toBe(prose);
      expect(turn.unsettled).toContain("未完整生成");
      expect(turn.world).toEqual(world);
      expect(turn.patches).toEqual([]);
      expect(requests.map((r) => r.responseFormat?.name)).toEqual(["judge", undefined]);
      expect(replay({ nextSeq: 0, world }, [record(turn)])).toEqual(world);
      const next = buildNarratorPrompt(world, [record(turn)], plan, { data: { items: [] } });
      expect(
        next.messages.some((m) => m.role === "assistant" && m.content.includes("蓝色刻痕")),
      ).toBe(false);
    },
  );
  it.each(["narrate", "extract"] as const)(
    "%s 断线保留草稿、不推进时间或推演，取消仍停止",
    async (disconnect) => {
      const { turn, world, requests } = await run({ disconnect });
      expect(turn.text).toBe(prose);
      expect(turn.unsettled).toBeDefined();
      expect(turn.world).toEqual(world);
      expect(turn.commands).toEqual([]);
      expect(turn.patches).toEqual([]);
      expect(
        requests.some((r) => ["offscreen", "summary"].includes(r.responseFormat?.name ?? "")),
      ).toBe(false);
      await expect(run({ disconnect, cancel: true })).rejects.toBeInstanceOf(NarratorAbortedError);
    },
  );
  it("流没有结束事件也只能留草稿", async () => {
    const { turn, world } = await run({ missingDone: true });
    expect(turn.unsettled).toBeDefined();
    expect(turn.world).toEqual(world);
  });
  it("抽取格式修复接口断线不会丢正文，也不会拿半份修复结算", async () => {
    const { turn, world, requests } = await run({ disconnect: "repair", extract: "无效JSON" });
    expect(turn.text).toBe(prose);
    expect(turn.unsettled).toBeDefined();
    expect(turn.world).toEqual(world);
    expect(requests.filter((r) => r.responseFormat?.name === "repair")).toHaveLength(1);
  });
  it("没有任何正文时保留原接口错误，不保存空草稿", async () => {
    await expect(run({ empty: true, disconnect: "narrate" })).rejects.toThrow("上游连接中断");
  });
});

describe("回合中按辅助模型窗口处理场外积压", () => {
  it("每轮只调一批，部分成功不推进全部期限，全部完成才记录成功时间", async () => {
    const base = newGameWorld({ startTime: 1000 });
    let world: WorldState = {
      ...base,
      slices: {
        ...base.slices,
        threads: ThreadsStateSchema.parse({
          threads: [
            {
              id: "clinic",
              kind: "faction",
              owner: "clinic",
              title: "诊所补货",
              want: "补货",
              stage: "等货车",
              openedAt: 800,
              dueAt: 900,
              reminded: true,
            },
          ],
        }),
      },
    };
    const records: LogRecord[] = Array.from({ length: 40 }, (_, seq) => ({
      kind: "turn",
      seq,
      at: "2026-11-16T00:00:00Z",
      requestId: `old-${seq}`,
      baseVersion: seq,
      input: { text: "观察街角" },
      dice: [],
      commands: [],
      dropped: [],
      text: `第${seq}件事。${"旧事经过".repeat(250)}结尾事实${seq}。`,
      patches: [],
      scene: 0,
    }));
    let prior = -1;
    let completed = false;
    for (let batch = 0; batch < 12; batch++) {
      const before = world;
      const { turn, requests } = await run({ world, records, auxWindow: 16_000 });
      const calls = requests.filter((r) => r.responseFormat?.name === "offscreen");
      expect(calls).toHaveLength(1);
      expect(calls[0]?.maxOutputTokens).toBe(1000);
      expect(
        calls[0]?.messages.reduce((n, m) => n + estimateTokens(m.content), 0),
      ).toBeLessThanOrEqual(14_200);
      const city = CityStateSchema.parse(turn.world.slices.city);
      expect(city.processedThrough).toBeGreaterThan(prior);
      if (city.backlog) {
        expect(city.lastAt).toBeNull();
        expect(turn.world.slices.threads).toEqual(before.slices.threads);
      } else {
        expect(city.lastAt).toBe(turn.world.time);
        completed = true;
      }
      const entry = record(turn, records.length);
      expect(replay({ nextSeq: records.length, world }, [...records, entry])).toEqual(turn.world);
      records.push(entry);
      world = turn.world;
      prior = city.processedThrough;
      if (completed) break;
    }
    expect(completed).toBe(true);
  });
  it("必要材料超窗时不发请求、不假记失败，正文仍正常保存", async () => {
    const { turn, requests } = await run({ auxWindow: 1000 });
    expect(turn.unsettled).toBeUndefined();
    expect(requests.some((r) => r.responseFormat?.name === "offscreen")).toBe(false);
    expect(turn.offscreenSkip).toContain("超过");
    expect(CityStateSchema.parse(turn.world.slices.city)).toMatchObject({
      processedThrough: -1,
      failures: 0,
      lastAt: null,
    });
  });
});
