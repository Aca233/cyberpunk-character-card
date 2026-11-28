import { applyPatches, enablePatches, type Patch } from "immer";
import { z } from "zod";
import { ImageSceneContextSchema } from "../schemas/image";
import { PresentedContentMediaSchema } from "../schemas/presented-content-media";
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

/** 特写卡：接到大单、首领现身、拿到不朽物品时弹一张；每个场景最多一张 */
export const CloseupSchema = z.object({
  kind: z.enum(["bigJob", "boss", "iconic"]),
  title: z.string().min(1),
  detail: z.string(),
});
export type Closeup = z.infer<typeof CloseupSchema>;

const TurnRecordSchema = z.object({
  kind: z.literal("turn"),
  seq,
  at: z.string(),
  requestId: z.string().min(1),
  /** 提交时基于的日志版本（当时的记录条数） */
  baseVersion: z.number().int().min(0),
  input: z.unknown(),
  dice: z.array(DiceRollSchema).optional(),
  commands: z.array(z.unknown()),
  /** 没通过校验、被丢弃的指令，只供调试 */
  dropped: z.array(z.unknown()),
  text: z.string(),
  /** 本轮思维链（模型原生推理流或思考标签提取），仅用于界面默认折叠展示，不进入记账与历史上下文。 */
  thought: z.string().optional(),
  /** 本轮实际读取或看片时展示的附件；只回看此快照，不展开未来材料。 */
  media: z.array(PresentedContentMediaSchema).optional(),
  /** 没有视觉资料时只按本轮正文配图，禁止借用当前世界状态。 */
  imageContext: ImageSceneContextSchema.optional(),
  patches: z.array(PatchSchema),
  /** 以下字段在切片 4 加入，旧存档没有 */
  /** 叙事模型对玩家意图的一句理解 */
  read: z.string().optional(),
  /** 建议选项，原样存下，展示时再按 schema 读 */
  choices: z.array(z.unknown()).optional(),
  /** @deprecated 兼容旧回合日志；运行期已移除内心声音 */
  voices: z.array(z.unknown()).optional(),
  /** 叙事模型标记的生死瞬间：下一轮可以开斯安威斯坦 */
  clutch: z.boolean().optional(),
  /** 这一轮发生在第几个场景；旧存档没有 */
  scene: z.number().int().min(0).optional(),
  /** 场景标题卡的一行，例如“沃森 · 歌舞伎区 · 22:40”；还没有地点时不写 */
  title: z.string().optional(),
  /** 这一轮弹出的特写卡 */
  closeup: CloseupSchema.optional(),
  /** 叙事模型提出、等玩家确认的检定 */
  check: z.unknown().optional(),
  /** 这一轮写的是哪次检定的结果 */
  resolves: z.string().optional(),
  /** 叙事模型判断这一轮是场外提问，不改状态；旧存档没有，按当时的输入方式判断 */
  ooc: z.boolean().optional(),
  /** 结算说明，例如“人性 −20 已截断为 −15” */
  notes: z.array(z.string()).optional(),
  /** 未定稿：关键条目被拒、被丢或被核对删掉时的原因；不进旧记忆 */
  unsettled: z.string().optional(),
  /** 未完整生成或尚未完成整份抽取，保存文字但没有结算；不能按账目改写为正式事实。 */
  draft: z.literal(true).optional(),
  /** 按账目改写：这一条替换掉第几轮（那一轮按作废算）；一行写完，不会只作废不替换 */
  replaces: seq.optional(),
  /** 抽取考虑过但没抽的，和原因；只供调试 */
  considered: z.array(z.string()).optional(),
  /** 判断给检定或门槛时写的理由；只供剧透视图 */
  ruling: z.string().optional(),
  /** ⑤ 审守则的提醒（替玩家角色说话、泄露秘密、死人出场）；只供剧透视图 */
  flags: z.array(z.string()).optional(),
  /** 场外推演发出的用户消息和原始回复；只供剧透视图 */
  offscreen: z.object({ prompt: z.string(), reply: z.string() }).optional(),
  /** 收了场却没推演时的原因；只供剧透视图 */
  offscreenSkip: z.string().optional(),
  /** 场景摘要发出的用户消息和原始回复；只供剧透视图 */
  summary: z.object({ prompt: z.string(), reply: z.string() }).optional(),
  /** 写正文之前代码定下的事；旧存档没有，上下文查看器重建时用 */
  decided: z.array(z.string()).optional(),
  /** 判断调出的旧记忆：标题和当时的正文 */
  recalled: z.array(z.object({ title: z.string(), text: z.string() })).optional(),
  /** 扩展层按分数补进来的旧记忆：标题和当时的正文 */
  expanded: z.array(z.object({ title: z.string(), text: z.string() })).optional(),
  /** 扩展层为什么检索、前几名的分数和退回原因；只供剧透视图 */
  retrieval: z
    .object({
      triggers: z.array(z.string()),
      top: z.array(
        z.object({ id: z.string(), title: z.string(), score: z.number(), parts: z.string() }),
      ),
      fallback: z.array(z.string()),
    })
    .optional(),
  /** 设定库：检索词、挑中的原作资料（来源键、分数、命中词）和当时发出的引用块；只供剧透视图，存档只在本机 */
  lore: z
    .object({
      terms: z.array(z.string()),
      picked: z.array(
        z.object({
          source: z.string(),
          title: z.string(),
          kind: z.string(),
          score: z.number(),
          hits: z.array(z.string()),
        }),
      ),
      candidates: z.number().int().min(0),
      note: z.string().optional(),
      section: z.string().optional(),
    })
    .optional(),
  /** 上下文预算：窗口、写正文带了几轮原文、【前情】额度、各部分占用和额度、裁了什么；重建写正文时照它带原文和【前情】 */
  budget: z
    .object({
      window: z.number().int().min(0),
      history: z.number().int().min(0),
      recapTokens: z.number().int().min(0),
      parts: z.array(
        z.object({
          part: z.string(),
          label: z.string(),
          tokens: z.number().int().min(0),
          limit: z.number().int().min(0).nullable(),
        }),
      ),
      total: z.number().int().min(0),
      limit: z.number().int(),
      cuts: z.array(z.string()),
    })
    .optional(),
  /** 本轮带了哪些规则模块 */
  modules: z.array(z.string()).optional(),
  usage: z
    .object({
      inputTokens: z.number().int().min(0),
      outputTokens: z.number().int().min(0),
      cachedInputTokens: z.number().int().min(0).optional(),
      cacheWriteTokens: z.number().int().min(0).optional(),
    })
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
  /** restart：夜之城难度死亡后从场景开头重来 */
  reason: z.enum(["undo", "regenerate", "correction", "restart"]),
  /** 重来的是第几个场景；只有 restart 写 */
  scene: z.number().int().min(0).optional(),
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

/** 玩家在界面上直接做的操作（分配属性点……），不调用模型，只改状态 */
const ActionRecordSchema = z.object({
  kind: z.literal("action"),
  seq,
  at: z.string(),
  requestId: z.string().min(1),
  /** 网页提交的操作，原样存下 */
  action: z.unknown(),
  commands: z.array(z.unknown()),
  notes: z.array(z.string()),
  patches: z.array(PatchSchema),
});

export const LogRecordSchema = z.discriminatedUnion("kind", [
  TurnRecordSchema,
  CheckRecordSchema,
  VoidRecordSchema,
  BackgroundRecordSchema,
  ActionRecordSchema,
]);

export type LogRecord = z.infer<typeof LogRecordSchema>;
export type TurnRecord = z.infer<typeof TurnRecordSchema>;
export type CheckRecord = z.infer<typeof CheckRecordSchema>;
export type VoidRecord = z.infer<typeof VoidRecordSchema>;
export type BackgroundRecord = z.infer<typeof BackgroundRecordSchema>;
export type ActionRecord = z.infer<typeof ActionRecordSchema>;
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
  validateLogSemantics(records);
  return { records, droppedPartialTail: !endsClean, cleanLength: body.length };
}

/** 日志版本就是记录条数；提交新的一轮时必须基于最新版本 */
export function logVersion(records: readonly LogRecord[]): number {
  return records.length;
}

/** 这条记录作废了哪一轮：作废记录的 target，或按账目改写的回合替换掉的那一轮 */
function voidTarget(record: LogRecord): number | undefined {
  if (record.kind === "void") return record.target;
  if (record.kind === "turn") return record.replaces;
  return undefined;
}

/** 只校验完整日志；voidedSeqs 还会用于筛过的历史，不能在它里面要求连续 seq。 */
function validateLogSemantics(records: readonly LogRecord[]): void {
  const voided = new Set<number>();
  for (const [index, record] of records.entries()) {
    if (record.seq !== index) {
      throw new LogCorruptError(`回合日志第 ${index + 1} 行的 seq 是 ${record.seq}，应为 ${index}`);
    }
    const target = voidTarget(record);
    if (target === undefined) continue;
    if (!Number.isInteger(target) || target < 0 || target >= record.seq) {
      throw new LogCorruptError(
        `回合日志第 ${index + 1} 行只能作废或替换之前存在的记录：${target}`,
      );
    }
    const previous = records[target];
    if (!previous || previous.kind === "void") {
      throw new LogCorruptError(`回合日志第 ${index + 1} 行的目标 ${target} 不是可作废的记录`);
    }
    if (record.kind === "turn" && previous.kind !== "turn") {
      throw new LogCorruptError(`回合日志第 ${index + 1} 行的改写目标 ${target} 不是回合`);
    }
    if (voided.has(target)) {
      throw new LogCorruptError(`回合日志第 ${index + 1} 行的目标 ${target} 已经作废或被替换`);
    }
    voided.add(target);
  }
}

export function voidedSeqs(records: readonly LogRecord[]): ReadonlySet<number> {
  const voided = new Set<number>();
  for (const record of records) {
    const target = voidTarget(record);
    if (target !== undefined) voided.add(target);
  }
  return voided;
}

/** 重来过的场景（夜之城难度每个场景只能重来一次） */
export function restartedScenes(records: readonly LogRecord[]): ReadonlySet<number> {
  const scenes = new Set<number>();
  for (const r of records) {
    if (r.kind === "void" && r.reason === "restart" && r.scene !== undefined) scenes.add(r.scene);
  }
  return scenes;
}

/** 没被作废的回合 */
export function effectiveTurns(records: readonly LogRecord[]): readonly TurnRecord[] {
  const voided = voidedSeqs(records);
  return records.filter((r): r is TurnRecord => r.kind === "turn" && !voided.has(r.seq));
}

/** 快照之后追加的作废记录如果指向快照已经算进去的记录，这个快照就失效了 */
export function isSnapshotValid(snapshot: Snapshot, records: readonly LogRecord[]): boolean {
  if (
    !Number.isInteger(snapshot.nextSeq) ||
    snapshot.nextSeq < 0 ||
    snapshot.nextSeq > records.length
  ) {
    return false;
  }
  for (const record of records.slice(snapshot.nextSeq)) {
    const target = voidTarget(record);
    if (target !== undefined && target < snapshot.nextSeq) return false;
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

function arrayIndex(key: string | number | undefined): number | undefined {
  if (typeof key === "string" && !/^(0|[1-9]\d*)$/.test(key)) return undefined;
  const index = typeof key === "number" ? key : Number(key);
  return Number.isSafeInteger(index) && index >= 0 ? index : undefined;
}

/** Immer 本身会忽略不存在的 remove、放宽 replace 与数组下标，重放前必须逐步核对。 */
function validatePatchTarget(world: WorldState, patch: Patch): void {
  const { path, op } = patch;
  if (path.length === 0) {
    if (op !== "replace") throw new Error("根状态只支持 replace");
    return;
  }
  if (path.some((key) => key === "__proto__" || key === "constructor" || key === "prototype")) {
    throw new Error("补丁路径含有禁止访问的原型属性");
  }
  let cur: unknown = world;
  for (let i = 0; i < path.length - 1; i++) {
    if (cur === null || typeof cur !== "object") throw new Error("补丁父路径不是对象或数组");
    const key = path[i];
    if (key === undefined || !Object.hasOwn(cur, key)) throw new Error("补丁父路径不存在");
    if (Array.isArray(cur)) {
      const index = arrayIndex(key);
      if (index === undefined || index >= cur.length) throw new Error("补丁父路径的数组下标无效");
      cur = cur[index];
    } else {
      cur = (cur as Record<string, unknown>)[String(key)];
    }
  }
  if (cur === null || typeof cur !== "object") throw new Error("补丁父路径不是对象或数组");
  const last = path[path.length - 1];
  if (last === undefined) throw new Error("补丁目标不存在");
  if (Array.isArray(cur)) {
    if (last === "length" && op === "replace") {
      if (
        typeof patch.value !== "number" ||
        !Number.isInteger(patch.value) ||
        patch.value < 0 ||
        patch.value > 0xffffffff
      ) {
        throw new Error("数组 length 必须是有效的非负整数");
      }
      return;
    }
    if (last === "-" && op === "add") return;
    const index = arrayIndex(last);
    if (
      index === undefined ||
      (op === "add" ? index > cur.length : index >= cur.length || !Object.hasOwn(cur, index))
    ) {
      throw new Error("补丁目标的数组下标无效");
    }
  } else if (op !== "add" && !Object.hasOwn(cur, last)) {
    throw new Error("补丁目标不存在");
  }
}

/**
 * 每个补丁必须能严格按顺序应用；任何一步失败都拒绝整次重放，不返回部分状态。
 * 供 replay、buildLedger、sceneStartSeq 共用，保持单一真相。
 */
export function applyRecordPatches(world: WorldState, patches: readonly Patch[]): WorldState {
  let next = world;
  for (const [index, patch] of patches.entries()) {
    try {
      validatePatchTarget(next, patch);
      next = applyPatches(next, [patch]);
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      throw new LogCorruptError(
        `补丁 ${index + 1}（${JSON.stringify(patch.path)}）无法重放：${why}`,
      );
    }
  }
  return next;
}

/** 从快照往后按记录里的补丁重放：不重掷骰子，不调用模型 */
export function replay(base: Snapshot, records: readonly LogRecord[]): WorldState {
  validateLogSemantics(records);
  if (!isSnapshotValid(base, records)) {
    throw new SnapshotStaleError(`快照（nextSeq ${base.nextSeq}）之后有作废记录指向更早的轮次`);
  }
  const voided = voidedSeqs(records);
  let world = base.world;
  for (const record of records.slice(base.nextSeq)) {
    if (record.kind === "void" || record.kind === "check" || voided.has(record.seq)) continue;
    world = applyRecordPatches(world, record.patches);
  }
  return world;
}
