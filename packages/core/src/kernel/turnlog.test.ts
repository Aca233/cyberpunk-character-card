import { describe, expect, it } from "vitest";
import {
  effectiveTurns,
  isSnapshotValid,
  LogCorruptError,
  type LogRecord,
  parseLog,
  pickSnapshot,
  replay,
  SnapshotStaleError,
  serializeRecord,
  type TurnRecord,
  type VoidRecord,
} from "./turnlog";
import type { Snapshot, WorldState } from "./world";

const at = "2077-08-20T21:00:00.000Z";
const initial: WorldState = { time: 0, slices: { counter: { value: 0 } } };
const origin: Snapshot = { nextSeq: 0, world: initial };

function turn(seq: number, value: number): TurnRecord {
  return {
    kind: "turn",
    seq,
    at,
    requestId: `req-${seq}`,
    baseVersion: seq,
    input: { text: "前进" },
    dice: [{ purpose: "check:tech", sides: 10, faces: [7] }],
    commands: [{ type: "counter.set", value }],
    dropped: [],
    text: `第 ${seq} 轮`,
    patches: [{ op: "replace", path: ["slices", "counter", "value"], value }],
  };
}

function undo(seq: number, target: number): VoidRecord {
  return { kind: "void", seq, at, target, reason: "undo" };
}

const toText = (records: readonly LogRecord[]) => records.map(serializeRecord).join("");
const counterValue = (world: WorldState) => (world.slices.counter as { value: number }).value;

describe("parseLog", () => {
  it("序列化后能原样读回", () => {
    const records = [turn(0, 1), turn(1, 2), undo(2, 1)];
    const text = toText(records);
    expect(parseLog(text)).toEqual({
      records,
      droppedPartialTail: false,
      cleanLength: text.length,
    });
  });

  it("空日志", () => {
    expect(parseLog("")).toEqual({ records: [], droppedPartialTail: false, cleanLength: 0 });
  });

  it("丢掉末尾写到一半的行，并报告干净长度", () => {
    const text = toText([turn(0, 1)]);
    const parsed = parseLog(`${text}{"kind":"tu`);
    expect(parsed.records).toHaveLength(1);
    expect(parsed.droppedPartialTail).toBe(true);
    expect(parsed.cleanLength).toBe(text.length);
  });

  it("只有半行时整条丢掉", () => {
    expect(parseLog('{"kind":"tu')).toEqual({
      records: [],
      droppedPartialTail: true,
      cleanLength: 0,
    });
  });

  it("seq 和行号不一致时报错", () => {
    expect(() => parseLog(toText([turn(1, 1)]))).toThrow(LogCorruptError);
  });

  it("中间有坏行时报错并指出行号", () => {
    expect(() => parseLog(`${toText([turn(0, 1)])}not json\n`)).toThrow(/第 2 行/);
  });

  it("字段不合法时报错", () => {
    expect(() => parseLog(`${JSON.stringify({ kind: "turn", seq: 0 })}\n`)).toThrow(/格式不对/);
  });
});

describe("作废、快照和重放", () => {
  it("重放跳过作废的回合", () => {
    const records = [turn(0, 1), turn(1, 2), undo(2, 1)];
    expect(counterValue(replay(origin, records))).toBe(1);
    expect(effectiveTurns(records).map((r) => r.seq)).toEqual([0]);
  });

  it("从快照重放和从头重放结果相同", () => {
    const records = [turn(0, 1), turn(1, 2), turn(2, 3)];
    const snapshot: Snapshot = { nextSeq: 2, world: replay(origin, records.slice(0, 2)) };
    expect(replay(snapshot, records)).toEqual(replay(origin, records));
    expect(counterValue(replay(snapshot, records))).toBe(3);
  });

  it("作废记录指向快照之前的回合时，快照失效", () => {
    const records = [turn(0, 1), turn(1, 2), undo(2, 1)];
    const stale: Snapshot = { nextSeq: 2, world: replay(origin, records.slice(0, 2)) };
    expect(isSnapshotValid(stale, records)).toBe(false);
    expect(() => replay(stale, records)).toThrow(SnapshotStaleError);
    expect(pickSnapshot([origin, stale], records)).toBe(origin);
  });

  it("作废快照之后的回合不影响快照", () => {
    const records = [turn(0, 1), turn(1, 2), undo(2, 1)];
    const snapshot: Snapshot = { nextSeq: 1, world: replay(origin, records.slice(0, 1)) };
    expect(isSnapshotValid(snapshot, records)).toBe(true);
    expect(pickSnapshot([origin, snapshot], records)).toBe(snapshot);
    expect(counterValue(replay(snapshot, records))).toBe(1);
  });

  it("快照比日志还新时失效", () => {
    const ahead: Snapshot = { nextSeq: 5, world: initial };
    expect(isSnapshotValid(ahead, [turn(0, 1)])).toBe(false);
    expect(pickSnapshot([ahead], [turn(0, 1)])).toBeUndefined();
  });
});
