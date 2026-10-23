import { applyPatches, enablePatches } from "immer";
import { z } from "zod";
import type { Snapshot, WorldState } from "./world";

enablePatches();

const PatchSchema = z.object({
  op: z.enum(["add", "remove", "replace"]),
  path: z.array(z.union([z.string(), z.number()])),
  value: z.unknown().optional(),
});

export const DiceRollSchema = z.object({
  /** 这次掷骰是为了什么，例如 check:tech */
  purpose: z.string(),
  sides: z.number().int().min(2),
  /** 爆骰时每一次的结果都记下 */
  faces: z.array(z.number().int().min(1)).min(1),
});

const seq = z.number().int().min(0);

const TurnRecordSchema = z.object({
  kind: z.literal("turn"),
  seq,
  at: z.string(),
  requestId: z.string().min(1),
  /** 提交时基于的日志版本（当时的记录条数） */
  baseVersion: z.number().int().min(0),
  input: z.unknown(),
  dice: z.array(DiceRollSchema),
  commands: z.array(z.unknown()),
  /** 没通过校验、被丢弃的指令，只供调试 */
  dropped: z.array(z.unknown()),
  text: z.string(),
  patches: z.array(PatchSchema),
  /** 以下字段在切片 4 加入，旧存档没有 */
  /** 主持人对玩家意图的一句理解 */
  read: z.string().optional(),
  /** 建议选项，原样存下，展示时再按 schema 读 */
  choices: z.array(z.unknown()).optional(),
  /** 主持人提出、等玩家确认的检定 */
  check: z.unknown().optional(),
  /** 这一轮写的是哪次检定的结果 */
  resolves: z.string().optional(),
  /** 结算说明，例如“人性 −20 已截断为 −15” */
  notes: z.array(z.string()).optional(),
  /** 本轮带了哪些规则模块 */
  modules: z.array(z.string()).optional(),
  usage: z
    .object({ inputTokens: z.number().int().min(0), outputTokens: z.number().int().min(0) })
    .optional(),
});

/** 玩家确认检定后、调模型之前写下的掷骰；之后重试和重新生成都用这次的骰面 */
const CheckRecordSchema = z.object({
  kind: z.literal("check"),
  seq,
  at: z.string(),
  requestId: z.string().min(1),
  /** 被确认的检定，例如 12（第 12 轮的 check）或 12.2（第 12 轮第 2 个选项的 check） */
  checkId: z.string().min(1),
  roll: DiceRollSchema,
});

const VoidRecordSchema = z.object({
  kind: z.literal("void"),
  seq,
  at: z.string(),
  /** 被作废的那条记录的 seq */
  target: seq,
  reason: z.enum(["undo", "regenerate", "correction"]),
});

const BackgroundRecordSchema = z.object({
  kind: z.literal("background"),
  seq,
  at: z.string(),
  sceneId: z.string(),
  /** 后台任务类型：场景摘要、传闻、人物卡补全、日记…… */
  task: z.string(),
  payload: z.unknown(),
  patches: z.array(PatchSchema),
});

export const LogRecordSchema = z.discriminatedUnion("kind", [
  TurnRecordSchema,
  CheckRecordSchema,
  VoidRecordSchema,
  BackgroundRecordSchema,
]);

export type LogRecord = z.infer<typeof LogRecordSchema>;
export type TurnRecord = z.infer<typeof TurnRecordSchema>;
export type CheckRecord = z.infer<typeof CheckRecordSchema>;
export type VoidRecord = z.infer<typeof VoidRecordSchema>;
export type BackgroundRecord = z.infer<typeof BackgroundRecordSchema>;
export type DiceRoll = z.infer<typeof DiceRollSchema>;

export class LogCorruptError extends Error {
  override name = "LogCorruptError";
}

export class SnapshotStaleError extends Error {
  override name = "SnapshotStaleError";
}

/** 一条记录占一行；整行一次写入 */
export function serializeRecord(record: LogRecord): string {
  return `${JSON.stringify(record)}\n`;
}

export interface ParsedLog {
  readonly records: readonly LogRecord[];
  /** 末尾有一行写到一半的记录被丢掉了 */
  readonly droppedPartialTail: boolean;
  /** 完整记录所占的字符数；存储层在下次追加前把文件截到这里 */
  readonly cleanLength: number;
}

export function parseLog(text: string): ParsedLog {
  const endsClean = text === "" || text.endsWith("\n");
  const body = endsClean ? text : text.slice(0, text.lastIndexOf("\n") + 1);
  const rows = body === "" ? [] : body.slice(0, -1).split("\n");
  const records: LogRecord[] = [];
  for (const [index, row] of rows.entries()) {
    let json: unknown;
    try {
      json = JSON.parse(row);
    } catch {
      throw new LogCorruptError(`回合日志第 ${index + 1} 行不是合法的 JSON`);
    }
    const parsed = LogRecordSchema.safeParse(json);
    if (!parsed.success) {
      throw new LogCorruptError(`回合日志第 ${index + 1} 行格式不对：${parsed.error.message}`);
    }
    if (parsed.data.seq !== index) {
      throw new LogCorruptError(
        `回合日志第 ${index + 1} 行的 seq 是 ${parsed.data.seq}，应为 ${index}`,
      );
    }
    records.push(parsed.data);
  }
  return { records, droppedPartialTail: !endsClean, cleanLength: body.length };
}

/** 日志版本就是记录条数；提交新的一轮时必须基于最新版本 */
export function logVersion(records: readonly LogRecord[]): number {
  return records.length;
}

export function voidedSeqs(records: readonly LogRecord[]): ReadonlySet<number> {
  const voided = new Set<number>();
  for (const record of records) if (record.kind === "void") voided.add(record.target);
  return voided;
}

/** 没被作废的回合 */
export function effectiveTurns(records: readonly LogRecord[]): readonly TurnRecord[] {
  const voided = voidedSeqs(records);
  return records.filter((r): r is TurnRecord => r.kind === "turn" && !voided.has(r.seq));
}

/** 快照之后追加的作废记录如果指向快照已经算进去的记录，这个快照就失效了 */
export function isSnapshotValid(snapshot: Snapshot, records: readonly LogRecord[]): boolean {
  if (snapshot.nextSeq > records.length) return false;
  for (const record of records.slice(snapshot.nextSeq)) {
    if (record.kind === "void" && record.target < snapshot.nextSeq) return false;
  }
  return true;
}

/** 选最新的有效快照；都失效时返回 undefined，调用方从初始世界重放 */
export function pickSnapshot(
  snapshots: readonly Snapshot[],
  records: readonly LogRecord[],
): Snapshot | undefined {
  return [...snapshots]
    .sort((a, b) => b.nextSeq - a.nextSeq)
    .find((snapshot) => isSnapshotValid(snapshot, records));
}

/** 从快照往后按记录里的补丁重放：不重掷骰子，不调用模型 */
export function replay(base: Snapshot, records: readonly LogRecord[]): WorldState {
  if (!isSnapshotValid(base, records)) {
    throw new SnapshotStaleError(`快照（nextSeq ${base.nextSeq}）之后有作废记录指向更早的轮次`);
  }
  const voided = voidedSeqs(records);
  let world = base.world;
  for (const record of records.slice(base.nextSeq)) {
    if (record.kind === "void" || record.kind === "check" || voided.has(record.seq)) continue;
    world = applyPatches(world, record.patches);
  }
  return world;
}
