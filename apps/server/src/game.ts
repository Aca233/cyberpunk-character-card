import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_LOADOUT,
  DEFAULT_OPENING,
  gameContent,
  gameData,
  openingPremise,
} from "@cp/content";
import {
  type ActionRecord,
  type ActionRequest,
  applyPlayerAction,
  boardStart,
  buildExtractPrompt,
  buildJudgePrompt,
  buildLedger,
  buildNarratorPrompt,
  type CheckRecord,
  type Clock,
  cityRules,
  currentOffers,
  diceRules,
  effectiveTurns,
  HISTORY_TURNS,
  isSnapshotValid,
  judgeCandidates,
  type LlmMessage,
  type LogRecord,
  type LoreSource,
  loadoutText,
  logVersion,
  memoryPool,
  NarratorAbortedError,
  NarratorEmptyReplyError,
  type NarratorPlan,
  type NarratorTurn,
  newGameWorld,
  OFFSCREEN_PACE_SCENES,
  OFFSCREEN_SYSTEM,
  type OffscreenPace,
  type PlayerView,
  parseLog,
  phoneRules,
  pickLoadouts,
  pickSnapshot,
  prepareFor,
  projectState,
  type Rng,
  replay,
  rewriteNarrative,
  rolledFrom,
  runNarratorTurn,
  type SaveMeta,
  SaveMetaSchema,
  SUMMARY_SYSTEM,
  sandevistanBlock,
  saveCharacter,
  sceneStartSeq,
  serializeRecord,
  TurnInputSchema,
  type TurnRecord,
  type TurnRequest,
  type TurnUsage,
  travelBlock,
  travelRules,
  type VoidRecord,
  voidedSeqs,
  type WorldState,
  withAllSlices,
  worldRules,
} from "@cp/core";
import { z } from "zod";
import type { CharacterStore } from "./characters";
import type { ConfigService } from "./config";
import { atomicWrite, KeyedMutex } from "./fsutil";
import { AbortedError, UpstreamError } from "./providers/http";
import type { LlmRouter } from "./providers/index";
import type { SaveStore } from "./storage";
import type { TurnHub, TurnRun } from "./turns";

/** 每追加这么多条记录写一次快照 */
export const SNAPSHOT_EVERY = 10;
export const DEFAULT_START = "2077-01-01 22:00";

export const CreateSaveSchema = z.strictObject({
  title: z.string().trim().min(1, "存档名不能为空").max(80, "存档名最多 80 字"),
  characterId: z.string().min(1),
  difficulty: z.enum(["streetLegend", "nightCity", "deathCity"]).default("nightCity"),
  /** 开场时间，格式 YYYY-MM-DD HH:mm；没给时用 DEFAULT_START（prefault 先填默认文本再解析） */
  startTime: worldRules.GameTimeSchema.prefault(DEFAULT_START),
});

/** 完整导出的文件格式：meta、整份回合日志和最新快照；含剧透，只用来备份和换电脑 */
export const SAVE_EXPORT_FORMAT = "cp2077-save";
export const SaveExportSchema = z.object({
  format: z.literal(SAVE_EXPORT_FORMAT),
  version: z.literal(1),
  exportedAt: z.string().optional(),
  meta: z.unknown(),
  records: z.array(z.unknown()),
  snapshot: z.unknown().optional(),
});

const ImportedSnapshotSchema = z.object({
  nextSeq: z.number().int().min(0),
  world: z.object({ time: z.number().int(), slices: z.record(z.string(), z.unknown()) }),
});

/** 键按字母排的 JSON，用来比两个世界状态是否一样 */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

const newSaveId = () => `s-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;

/** 路由直接把 body 按 status 返回 */
export interface Reply {
  readonly status: 200 | 201 | 202 | 400 | 404 | 409 | 502 | 503;
  readonly body: Record<string, unknown>;
}

export interface GameDeps {
  readonly saves: SaveStore;
  readonly characters: CharacterStore;
  readonly config: ConfigService;
  readonly llm: LlmRouter;
  readonly hub: TurnHub;
  readonly clock: Clock;
  /** 玩家检定用的骰子 */
  readonly rng: Rng;
  readonly log: (message: string) => void;
  /** 「存为评测用例」写草稿的目录；不给时不能存 */
  readonly evalDrafts?: string | undefined;
  /** 设定库：本机官方文本库的只读检索；没有文本库时不给，写正文就不带原作资料 */
  readonly lore?: LoreSource | undefined;
}

interface Loaded {
  readonly meta: SaveMeta;
  readonly records: readonly LogRecord[];
  readonly world: WorldState;
}

class VersionMovedError extends Error {
  override name = "VersionMovedError";
}

function addUsage(a: TurnUsage | undefined, b: TurnUsage): TurnUsage | undefined {
  if (!a && b.inputTokens === 0 && b.outputTokens === 0) return undefined;
  return {
    inputTokens: (a?.inputTokens ?? 0) + b.inputTokens,
    outputTokens: (a?.outputTokens ?? 0) + b.outputTokens,
  };
}

/**
 * 存档和回合：同一存档的读写都排在一把锁里。
 * 行动的顺序是 校验 → 登记进行中 → 调叙事模型（锁外） → 加锁追加回合日志；
 * 确认检定时先在锁里掷骰并写进日志，再走同样的流程，这样重试和刷新都不会重掷。
 * 被拦截、停止或出错的轮次不写回合记录，已经写下的骰子保留，下次确认同一个检定时沿用
 */
export class GameService {
  private readonly locks = new KeyedMutex();

  constructor(private readonly deps: GameDeps) {}

  async list(): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = [];
    for (const id of await this.deps.saves.list()) {
      try {
        const meta = await this.deps.saves.readMeta(id);
        out.push({ id, ...meta, running: this.deps.hub.running(id) !== undefined });
      } catch (error) {
        this.deps.log(
          `跳过读不了的存档 ${id}：${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return out;
  }

  async create(input: z.output<typeof CreateSaveSchema>): Promise<Reply> {
    const id = newSaveId();
    const entry = await this.deps.characters.get(input.characterId);
    if (!entry) return { status: 400, body: { error: "没有这个角色，先在角色页建一个" } };
    const start = boardStart(entry.card);
    const meta: SaveMeta = {
      ...input,
      createdAt: this.deps.clock.now().toISOString(),
      character: saveCharacter(entry.card),
      opening: DEFAULT_OPENING,
      loadouts: pickLoadouts(loadoutText(entry.card), gameContent.loadouts ?? [], DEFAULT_LOADOUT),
      ...(start ? { board: start } : {}),
    };
    await this.deps.saves.create(id, meta);
    return { status: 201, body: { id, ...meta } };
  }

  /** 完整导出：meta、整份回合日志和最新的有效快照；含剧透 */
  exportSave(id: string): Promise<Reply> {
    return this.locks.run(id, async (): Promise<Reply> => {
      const meta = await this.deps.saves.readMeta(id);
      const log = await this.deps.saves.loadLog(id);
      const snapshot = pickSnapshot(await this.deps.saves.readSnapshots(id), log.records) ?? null;
      return {
        status: 200,
        body: {
          format: SAVE_EXPORT_FORMAT,
          version: 1,
          exportedAt: this.deps.clock.now().toISOString(),
          meta,
          records: log.records,
          snapshot,
        },
      };
    });
  }

  /** 导入完整导出：逐行校验日志、从头重放；快照对不上时以日志为准，建成一个新存档 */
  async importSave(input: z.output<typeof SaveExportSchema>): Promise<Reply> {
    const meta = SaveMetaSchema.safeParse(input.meta);
    if (!meta.success) return { status: 400, body: { error: "存档信息（meta）格式不对" } };
    let records: readonly LogRecord[];
    try {
      records = parseLog(input.records.map((r) => `${JSON.stringify(r)}\n`).join("")).records;
    } catch (error) {
      return {
        status: 400,
        body: { error: error instanceof Error ? error.message : String(error) },
      };
    }
    let world: WorldState;
    try {
      world = replay(
        { nextSeq: 0, world: withAllSlices(newGameWorld(meta.data, gameContent)) },
        records,
      );
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      return { status: 400, body: { error: `回合日志重放不了：${why}` } };
    }
    const notes: string[] = [];
    if (input.snapshot !== undefined && input.snapshot !== null) {
      const snap = ImportedSnapshotSchema.safeParse(input.snapshot);
      let same = false;
      if (snap.success && isSnapshotValid(snap.data, records)) {
        try {
          const fromSnap = replay({ ...snap.data, world: withAllSlices(snap.data.world) }, records);
          same = stableJson(fromSnap) === stableJson(world);
        } catch {
          same = false;
        }
      }
      if (!same) notes.push("导出文件里的快照和回合日志对不上，已按回合日志重建");
    }
    const id = newSaveId();
    await this.deps.saves.create(id, meta.data);
    if (records.length > 0) {
      await this.deps.saves.importLog(id, records.map(serializeRecord).join(""));
      await this.deps.saves.writeSnapshot(id, { nextSeq: records.length, world });
    }
    return { status: 201, body: { id, ...meta.data, notes } };
  }

  async state(id: string): Promise<PlayerView> {
    return this.locks.run(id, async () => {
      const { world, records } = await this.load(id);
      return projectState(world, records, gameData);
    });
  }

  submit(id: string, request: TurnRequest): Promise<Reply> {
    const { hub } = this.deps;
    return this.locks.run(id, async (): Promise<Reply> => {
      const { meta, world, records } = await this.load(id);
      const version = logVersion(records);
      const done = records.find((r) => r.kind === "turn" && r.requestId === request.requestId);
      if (done) return { status: 200, body: { duplicate: true, seq: done.seq, version } };
      const dead = deathBlock(world, records, version);
      if (dead) return dead;
      const same = hub.byRequest(id, request.requestId);
      if (same) return { status: 202, body: { turnId: same.turnId, replayed: true } };
      const busy = hub.running(id);
      if (busy)
        return {
          status: 409,
          body: { error: "上一轮还在生成，先等它结束或停止", turnId: busy.turnId, version },
        };
      const offers = currentOffers(records);

      if (request.confirm !== undefined) {
        const offer = offers.checks.find((c) => c.id === request.confirm);
        if (!offer) {
          return { status: 409, body: { error: "检定已失效，请刷新后再选", version } };
        }
        const rolled = offers.rolled;
        if (rolled && rolled.offer.id !== offer.id) {
          return {
            status: 409,
            body: {
              error: `已经掷过「${rolled.offer.label}」，先确认它的结果`,
              checkId: rolled.offer.id,
              version,
            },
          };
        }
        if (request.baseVersion !== version && request.baseVersion !== rolled?.record.seq) {
          return { status: 409, body: { error: "存档已经更新过，请刷新后再提交", version } };
        }
        const unavailable = await this.llmUnavailable();
        if (unavailable) return unavailable;

        // 矩阵小游戏的完成情况在掷骰时记进骰子记录；已经掷过的照记录里的算
        const target = rolled
          ? rolled.offer
          : { ...offer, spec: diceRules.withMatrix(offer.spec, request.matrix) };
        let log = records;
        let faces: readonly number[];
        let baseVersion = version;
        if (rolled) {
          faces = rolled.record.roll.faces;
        } else {
          const prepared = prepareFor(world, target.spec);
          if (!prepared.ok) {
            return {
              status: 409,
              body: { error: `这个检定已经不能掷：${prepared.reason}`, version },
            };
          }
          faces = diceRules.rollFaces(this.deps.rng);
          const record: CheckRecord = {
            kind: "check",
            seq: version,
            at: this.deps.clock.now().toISOString(),
            requestId: request.requestId,
            checkId: offer.id,
            ...(request.matrix === undefined ? {} : { matrix: request.matrix }),
            roll: diceRules.diceRecord(
              prepared.check,
              diceRules.resolveCheck(prepared.check, faces),
            ),
          };
          await this.deps.saves.appendLog(id, serializeRecord(record));
          baseVersion = version + 1;
          await this.maybeSnapshot(id, baseVersion);
          log = [...records, record];
        }
        const check = rolledFrom(world, target, faces);
        const plan: NarratorPlan = {
          kind: "resolve",
          input: { text: offer.label },
          check,
        };
        const run = hub.start(id, request.requestId, baseVersion);
        hub.push(run, {
          type: "rolled",
          checkId: offer.id,
          faces: check.result.faces,
          total: check.result.total,
          dv: check.result.dv,
          outcome: check.result.outcome,
        });
        void this.execute(run, world, log, plan, meta.opening, meta.startTime, request.offscreen);
        return { status: 202, body: { turnId: run.turnId, replayed: false } };
      }

      if (request.input === undefined) throw new Error("回合请求既没有行动也没有确认");
      if (offers.rolled) {
        return {
          status: 409,
          body: {
            error: `已经掷过「${offers.rolled.offer.label}」，先确认它的结果`,
            checkId: offers.rolled.offer.id,
            version,
          },
        };
      }
      if (request.baseVersion !== version) {
        return { status: 409, body: { error: "存档已经更新过，请刷新后再提交", version } };
      }
      if (request.input.sandevistan) {
        const blocked = sandevistanBlock(world, records, gameData);
        if (blocked) return { status: 409, body: { error: blocked, version } };
      }
      if (request.input.travel !== undefined) {
        const blocked = travelBlock(world, gameData, request.input.travel);
        if (blocked) return { status: 409, body: { error: blocked, version } };
      }
      if (request.input.replyTo !== undefined) {
        const blocked = phoneRules.replyBlock(world, request.input.replyTo);
        if (blocked) return { status: 409, body: { error: blocked, version } };
      }
      const unavailable = await this.llmUnavailable();
      if (unavailable) return unavailable;
      const run = hub.start(id, request.requestId, version);
      void this.execute(
        run,
        world,
        records,
        { kind: "action", input: request.input },
        meta.opening,
        meta.startTime,
        request.offscreen,
        request.encounters,
      );
      return { status: 202, body: { turnId: run.turnId, replayed: false } };
    });
  }

  /** 界面操作（分配属性点……）：不调用模型，结算后写一条 action 记录 */
  action(id: string, request: ActionRequest): Promise<Reply> {
    return this.locks.run(id, async (): Promise<Reply> => {
      const { world, records } = await this.load(id);
      const version = logVersion(records);
      const done = records.find((r) => r.kind === "action" && r.requestId === request.requestId);
      if (done) return { status: 200, body: { duplicate: true, seq: done.seq, version } };
      const dead = deathBlock(world, records, version);
      if (dead) return dead;
      if (this.deps.hub.running(id)) {
        return { status: 409, body: { error: "这一轮还在生成，等它结束再操作", version } };
      }
      if (currentOffers(records).rolled) {
        return { status: 409, body: { error: "先确认已经掷过的检定", version } };
      }
      if (request.baseVersion !== version) {
        return { status: 409, body: { error: "存档已经更新过，请刷新后再操作", version } };
      }
      const result = applyPlayerAction(world, request.action, {
        rng: this.deps.rng,
        data: gameData,
      });
      if (!result.ok) return { status: 409, body: { error: result.reason, version } };
      const record: ActionRecord = {
        kind: "action",
        seq: version,
        at: this.deps.clock.now().toISOString(),
        requestId: request.requestId,
        action: request.action,
        commands: [...result.commands],
        notes: [...result.notes],
        patches: [...result.patches],
      };
      await this.deps.saves.appendLog(id, serializeRecord(record));
      await this.maybeSnapshot(id, version + 1);
      return { status: 200, body: { seq: version, version: version + 1, notes: result.notes } };
    });
  }

  /**
   * 夜之城难度死亡后从这个场景开头重来：把场景开始以后的回合、掷骰和操作都作废，
   * 骰子之后重新掷；每个场景只能重来一次，作废记录就是履历里的“重来过”
   */
  restart(id: string, request: z.output<typeof RestartRequestSchema>): Promise<Reply> {
    return this.locks.run(id, async (): Promise<Reply> => {
      const { meta, world, records } = await this.load(id);
      const version = logVersion(records);
      if (this.deps.hub.running(id)) {
        return { status: 409, body: { error: "这一轮还在生成，等它结束再操作", version } };
      }
      if (request.baseVersion !== version) {
        return { status: 409, body: { error: "存档已经更新过，请刷新后再操作", version } };
      }
      const view = projectState(world, records, gameData);
      if (!view.death) return { status: 409, body: { error: "角色还活着，不用重来", version } };
      if (!view.death.canRestart) {
        return {
          status: 409,
          body: {
            error:
              view.difficulty === "nightCity"
                ? "这个场景已经重来过一次，这一次是真的死了"
                : "这个难度死了就结束，不能重来",
            version,
          },
        };
      }
      const start = sceneStartSeq(newGameWorld(meta, gameContent), records);
      const voided = voidedSeqs(records);
      const targets = records.filter(
        (r) => r.seq >= start && r.kind !== "void" && !voided.has(r.seq),
      );
      const at = this.deps.clock.now().toISOString();
      let seq = version;
      for (const target of targets) {
        const record: VoidRecord = {
          kind: "void",
          seq,
          at,
          target: target.seq,
          reason: "restart",
          scene: view.scene,
        };
        await this.deps.saves.appendLog(id, serializeRecord(record));
        seq += 1;
      }
      return { status: 200, body: { version: seq, voided: targets.length } };
    });
  }

  /**
   * 重新生成最后一轮：把它作废（reason regenerate），返回当时的输入或确认的检定，
   * 网页再按原来的提交流程重发；掷过的骰子还在日志里，不重掷
   */
  regenerate(id: string, request: z.output<typeof RegenerateRequestSchema>): Promise<Reply> {
    return this.locks.run(id, async (): Promise<Reply> => {
      const { world, records } = await this.load(id);
      const version = logVersion(records);
      if (this.deps.hub.running(id)) {
        return { status: 409, body: { error: "这一轮还在生成，等它结束再操作", version } };
      }
      if (request.baseVersion !== version) {
        return { status: 409, body: { error: "存档已经更新过，请刷新后再操作", version } };
      }
      if (projectState(world, records, gameData).death) {
        return { status: 409, body: { error: "角色已经死了，不能重新生成", version } };
      }
      const voided = voidedSeqs(records);
      const last = records.findLast((r) => r.kind !== "void" && !voided.has(r.seq));
      if (last?.kind !== "turn" || last.seq === 0) {
        return {
          status: 409,
          body: { error: "最后一步不是可以重写的回合（之后可能有别的操作）", version },
        };
      }
      const input = TurnInputSchema.safeParse(last.input);
      if (!input.success) {
        return { status: 409, body: { error: "这一轮的输入读不出来，不能重新生成", version } };
      }
      const record: VoidRecord = {
        kind: "void",
        seq: version,
        at: this.deps.clock.now().toISOString(),
        target: last.seq,
        reason: "regenerate",
      };
      await this.deps.saves.appendLog(id, serializeRecord(record));
      const pending =
        last.resolves !== undefined
          ? { kind: "confirm", checkId: last.resolves, label: input.data.text }
          : { kind: "input", input: input.data };
      return { status: 200, body: { version: version + 1, voided: last.seq, pending } };
    });
  }

  /**
   * 按账目改写最后一轮：只按已经结算的账目重写正文，不重掷、不改状态。
   * 和回合一样：锁里校验 → 锁外调叙事模型 → 锁里确认存档没动过再追加；
   * 追加的回合照抄指令、骰子和状态变化，只换正文，用 replaces 一行替换掉原来那一轮
   */
  async rewrite(id: string, request: z.output<typeof RegenerateRequestSchema>): Promise<Reply> {
    const checked = await this.locks.run(
      id,
      async (): Promise<{ reply: Reply } | { last: TurnRecord; version: number }> => {
        const { world, records } = await this.load(id);
        const version = logVersion(records);
        const refuse = (error: string): { reply: Reply } => ({
          reply: { status: 409, body: { error, version } },
        });
        if (this.deps.hub.running(id)) return refuse("这一轮还在生成，等它结束再操作");
        if (request.baseVersion !== version) return refuse("存档已经更新过，请刷新后再操作");
        if (projectState(world, records, gameData).death) return refuse("角色已经死了，不能改写");
        const voided = voidedSeqs(records);
        const last = records.findLast((r) => r.kind !== "void" && !voided.has(r.seq));
        if (last?.kind !== "turn" || last.seq === 0) {
          return refuse("最后一步不是可以改写的回合（之后可能有别的操作）");
        }
        if (last.unsettled === undefined) return refuse("这一轮的正文和账目对得上，不用改写");
        return { last, version };
      },
    );
    if ("reply" in checked) return checked.reply;
    const { last, version } = checked;
    const unavailable = await this.llmUnavailable();
    if (unavailable) return unavailable;
    const redact = await this.deps.config.redactor();
    let result: Awaited<ReturnType<typeof rewriteNarrative>>;
    try {
      result = await rewriteNarrative(this.deps.llm, last, AbortSignal.timeout(REWRITE_TIMEOUT_MS));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        status: 502,
        body: { error: `改写失败：${redact(message)}；原来的正文保留`, version },
      };
    }
    if (!result.ok) return { status: 502, body: { error: redact(result.error), version } };
    const text = result.text;
    const usage = result.usage;
    return this.locks.run(id, async (): Promise<Reply> => {
      const { records } = await this.load(id);
      const now = logVersion(records);
      if (now !== version || this.deps.hub.running(id)) {
        return {
          status: 409,
          body: {
            error: "改写期间存档有了新的变化，这次改写没有写进去，原来的正文保留",
            version: now,
          },
        };
      }
      const { unsettled: _unsettled, ...kept } = last;
      const record: TurnRecord = {
        ...kept,
        seq: version,
        at: this.deps.clock.now().toISOString(),
        requestId: `${last.requestId}.rewrite`,
        baseVersion: version,
        text,
        replaces: last.seq,
        ...(usage ? { usage } : {}),
      };
      await this.deps.saves.appendLog(id, serializeRecord(record));
      return { status: 200, body: { version: version + 1, replaced: last.seq } };
    });
  }

  stop(id: string, turnId: string): Reply {
    const run = this.deps.hub.get(id, turnId);
    if (!run) return { status: 404, body: { error: "没有这一轮，可能已经过期" } };
    if (run.finishedAt !== null) {
      return { status: 409, body: { error: "这一轮已经结束", result: run.events.at(-1)?.type } };
    }
    run.controller.abort();
    return { status: 202, body: { stopping: true } };
  }

  /**
   * 上下文查看器：第 seq 轮的规则模块、被丢弃的指令、token 用量，
   * 以及按回合日志重建的这一轮发给叙事模型的内容（不含格式修复的那次调用）
   */
  context(id: string, seq: number): Promise<Reply> {
    return this.locks.run(id, async (): Promise<Reply> => {
      const meta = await this.deps.saves.readMeta(id);
      const { records } = await this.deps.saves.loadLog(id);
      const record = records[seq];
      if (record?.kind !== "turn" || !effectiveTurns(records).includes(record)) {
        return { status: 404, body: { error: `没有第 ${seq} 轮` } };
      }
      const before = records.slice(0, seq);
      const world = replay({ nextSeq: 0, world: newGameWorld(meta, gameContent) }, before);
      const input = TurnInputSchema.safeParse(record.input);
      let prompts: StagePrompt[] = [];
      let rebuildError: string | null = null;
      try {
        if (!input.success) throw new Error("这一轮的玩家输入格式不对");
        let plan: NarratorPlan = { kind: "action", input: input.data };
        if (record.resolves !== undefined) {
          const offer = currentOffers(before).checks.find((o) => o.id === record.resolves);
          const rolled = before.findLast(
            (r): r is CheckRecord => r.kind === "check" && r.checkId === record.resolves,
          );
          if (!offer || !rolled) throw new Error(`找不到检定 ${record.resolves} 的骰子记录`);
          plan = {
            ...plan,
            kind: "resolve",
            check: rolledFrom(
              world,
              { ...offer, spec: diceRules.withMatrix(offer.spec, rolled.matrix) },
              rolled.roll.faces,
            ),
          };
        }
        const extras = {
          data: gameData,
          opening: openingPremise(meta.opening),
          startTime: meta.startTime,
        };
        const stage = (
          id: StagePrompt["stage"],
          label: string,
          built: { messages: readonly LlmMessage[]; modules: readonly string[] },
        ): StagePrompt => ({
          stage: id,
          label,
          messages: [...built.messages],
          modules: [...built.modules],
          chars: built.messages.reduce((n, m) => n + m.content.length, 0),
        });
        // ① 判断：确认检定的那一轮、场外提问的旧存档没有这一步
        if (plan.kind === "action" && input.data.mode !== "ooc") {
          const lately = effectiveTurns(before)
            .slice(-2)
            .map((t) => t.text)
            .join("\n");
          const pool = memoryPool(
            world,
            before,
            record.budget?.history ?? HISTORY_TURNS,
            record.budget?.recapTokens,
          );
          const memories = judgeCandidates(pool, world, {
            input: input.data.text,
            context: lately,
          });
          prompts.push(
            stage("judge", "① 判断", buildJudgePrompt(world, before, plan, extras, memories)),
          );
        }
        prompts.push(
          stage(
            "narrate",
            record.decided === undefined
              ? "③ 写正文（旧存档没记已定的事，只是大致还原）"
              : "③ 写正文",
            buildNarratorPrompt(world, before, plan, {
              ...extras,
              decided: record.decided,
              recalled: [...(record.recalled ?? []), ...(record.expanded ?? [])],
              lore: record.lore?.section,
              history: record.budget?.history,
              recapTokens: record.budget?.recapTokens,
            }),
          ),
        );
        // ④ 抽取：场外提问和等检定的轮次不抽
        if (record.ooc !== true && record.check === undefined) {
          prompts.push(
            stage(
              "extract",
              "④ 抽取",
              buildExtractPrompt(world, before, plan, extras, record.text),
            ),
          );
        }
        // ⑥ 场外推演：发出的内容和回复是记下来的，不用重建
        if (record.offscreen) {
          prompts.push(
            stage("offscreen", "⑥ 场外推演", {
              messages: [
                { role: "system", content: OFFSCREEN_SYSTEM },
                { role: "user", content: record.offscreen.prompt },
                { role: "assistant", content: record.offscreen.reply },
              ],
              modules: [],
            }),
          );
        }
        // ⑦ 场景摘要：同样是记下来的
        if (record.summary) {
          prompts.push(
            stage("summary", "⑦ 场景摘要", {
              messages: [
                { role: "system", content: SUMMARY_SYSTEM },
                { role: "user", content: record.summary.prompt },
                { role: "assistant", content: record.summary.reply },
              ],
              modules: [],
            }),
          );
        }
      } catch (error) {
        prompts = [];
        rebuildError = error instanceof Error ? error.message : String(error);
      }
      const narrate = prompts.find((p) => p.stage === "narrate");
      const prompt = narrate ? { messages: narrate.messages, modules: narrate.modules } : null;
      const total = { inputTokens: 0, outputTokens: 0, turns: 0 };
      for (const turn of effectiveTurns(records)) {
        if (!turn.usage) continue;
        total.inputTokens += turn.usage.inputTokens;
        total.outputTokens += turn.usage.outputTokens;
        total.turns += 1;
      }
      return {
        status: 200,
        body: {
          seq,
          at: record.at,
          input: input.success ? input.data : null,
          text: record.text,
          read: record.read ?? null,
          modules: record.modules ?? [],
          commands: record.commands,
          dropped: record.dropped,
          notes: record.notes ?? [],
          considered: record.considered ?? [],
          ruling: record.ruling ?? null,
          flags: record.flags ?? [],
          // 扩展层：为什么检索、前几名的分数、补进来的条目和退回原因；旧记录没有
          retrieval: record.retrieval
            ? { ...record.retrieval, picked: (record.expanded ?? []).map((m) => m.title) }
            : null,
          recalled: (record.recalled ?? []).map((m) => m.title),
          // 上下文预算：窗口、带了几轮原文、各部分用量对上限、为了塞进窗口砍掉了什么；旧记录没有
          budget: record.budget ?? null,
          // 设定库：检索词、挑中的原作资料和分数、没给的原因；没接文本库或旧记录时为 null
          lore: record.lore
            ? {
                terms: record.lore.terms,
                picked: record.lore.picked,
                candidates: record.lore.candidates,
                note: record.lore.note ?? null,
              }
            : null,
          // ⑥ 没跑的原因：收场时记下的，其余按这一轮的情况推
          offscreenSkip: record.offscreen
            ? null
            : (record.offscreenSkip ??
              (record.ooc
                ? "场外提问，不推演"
                : record.check !== undefined
                  ? "这一轮在等检定，还没结算"
                  : "这一轮没收场")),
          // 这一轮结算之后城里的动静（含已结束的），只在剧透视图里看
          city: cityRules.CityStateSchema.parse(
            replay(
              { nextSeq: 0, world: newGameWorld(meta, gameContent) },
              records.slice(0, seq + 1),
            ).slices.city ?? {},
          ).events.map((e) => ({
            id: e.id,
            title: e.title,
            body: e.body,
            district: e.district ?? null,
            status: cityRules.CITY_STATUS_LABELS[e.status],
            weight: e.weight,
            over: e.status === "over",
            updatedAt: e.updatedAt,
          })),
          // 账目对账：最近 10 轮各改了哪些硬数值，和当时生效的指令
          ledger: buildLedger(
            { nextSeq: 0, world: newGameWorld(meta, gameContent) },
            records.slice(0, seq + 1),
          ),
          unsettled: record.unsettled ?? null,
          check: record.check ?? null,
          choices: record.choices ?? [],
          dice: record.dice,
          resolves: record.resolves ?? null,
          usage: record.usage ?? null,
          totalUsage: total,
          prompt,
          prompts,
          rebuildError,
        },
      };
    });
  }

  /**
   * 上下文查看器的「存为评测用例」：截出第 seq 轮之前的世界和回合日志、这一轮的输入，
   * 连同当时的回复写成用例草稿；补上期望后移到 tools/evals/ 才进测评
   */
  evalDraft(id: string, seq: number): Promise<Reply> {
    return this.locks.run(id, async (): Promise<Reply> => {
      const dir = this.deps.evalDrafts;
      if (!dir) return { status: 404, body: { error: "后端没有配置评测用例草稿目录" } };
      const meta = await this.deps.saves.readMeta(id);
      const { records } = await this.deps.saves.loadLog(id);
      const record = records[seq];
      if (record?.kind !== "turn" || !effectiveTurns(records).includes(record)) {
        return { status: 404, body: { error: `没有第 ${seq} 轮` } };
      }
      const input = TurnInputSchema.safeParse(record.input);
      if (!input.success) return { status: 400, body: { error: "这一轮的玩家输入格式不对" } };
      const before = records.slice(0, seq);
      let ask: Record<string, unknown> = { input: input.data };
      if (record.resolves !== undefined) {
        const rolled = before.findLast(
          (r): r is CheckRecord => r.kind === "check" && r.checkId === record.resolves,
        );
        if (!rolled) {
          return { status: 409, body: { error: `找不到检定 ${record.resolves} 的骰子记录` } };
        }
        ask = { confirm: { checkId: record.resolves, faces: rolled.roll.faces } };
      }
      const world = replay({ nextSeq: 0, world: newGameWorld(meta, gameContent) }, before);
      const opening = openingPremise(meta.opening);
      const caseId = `playtest-${id}-${seq}`;
      const draft = {
        id: caseId,
        title: `试玩「${meta.title}」第 ${seq} 轮：写清这一轮哪里不对`,
        tags: ["playtest"],
        setup: {
          difficulty: meta.difficulty,
          snapshot: { ...(opening ? { opening } : {}), world, records: before },
        },
        ...ask,
        expect: {},
        rubric: [],
        actual: {
          text: record.text,
          commands: record.commands,
          dropped: record.dropped,
          check: record.check ?? null,
          choices: record.choices ?? [],
        },
      };
      await mkdir(dir, { recursive: true });
      await atomicWrite(join(dir, `${caseId}.json`), `${JSON.stringify(draft, null, 2)}\n`);
      return { status: 201, body: { id: caseId, file: `tools/evals/drafts/${caseId}.json` } };
    });
  }

  /** 叙事模型没配好时直接告诉玩家，不换别的服务商 */
  private async llmUnavailable(): Promise<Reply | undefined> {
    const resolved = await this.deps.llm.resolve("narrator");
    if (resolved.ok) return undefined;
    const redact = await this.deps.config.redactor();
    return { status: 503, body: { error: redact(resolved.error) } };
  }

  private async execute(
    run: TurnRun,
    world: WorldState,
    records: readonly LogRecord[],
    plan: NarratorPlan,
    opening: string | undefined,
    startTime: number,
    offscreen: OffscreenPace | undefined,
    encounters?: travelRules.EncounterPace,
  ): Promise<void> {
    const { hub } = this.deps;
    const redact = await this.deps.config.redactor();
    const signal = run.controller.signal;
    try {
      const resolved = await this.deps.llm.resolve("narrator");
      if (!resolved.ok) {
        hub.push(run, { type: "error", message: redact(resolved.error), retryable: false });
        return;
      }
      const result = await runNarratorTurn(
        {
          llm: this.deps.llm,
          contextWindow: resolved.profile.contextWindow,
          rng: this.deps.rng,
          data: gameData,
          opening: openingPremise(opening),
          startTime,
          offscreen: OFFSCREEN_PACE_SCENES[offscreen ?? "normal"],
          encounters: travelRules.ENCOUNTER_PACE_FACTORS[encounters ?? "normal"],
          lore: this.deps.lore,
          signal,
          onText: (text) => hub.push(run, { type: "text", text }),
        },
        world,
        records,
        plan,
      );
      if (result.kind === "blocked") {
        hub.push(run, { type: "blocked", reason: redact(result.reason) });
        return;
      }
      if (result.kind === "confirmSpend") {
        const { label, price, eddies } = result;
        hub.push(run, { type: "confirmSpend", label, price, eddies });
        return;
      }
      if (signal.aborted) throw new NarratorAbortedError("已停止");
      const { turn } = result;
      const usage = addUsage(addUsage(turn.usage, turn.auxUsage), turn.repairUsage);
      const saved = await this.commit(run, plan, turn, usage);
      if (turn.repairs > 0) {
        this.deps.log(`存档 ${run.saveId} 第 ${saved.seq} 轮修了 ${turn.repairs} 次指令格式`);
      }
      hub.push(run, { type: "done", ...saved, ...(usage ? { usage } : {}) });
    } catch (error) {
      if (
        error instanceof NarratorAbortedError ||
        error instanceof AbortedError ||
        signal.aborted
      ) {
        hub.push(run, { type: "stopped" });
      } else if (error instanceof NarratorEmptyReplyError) {
        hub.push(run, { type: "error", message: "模型没有返回正文，可以重试", retryable: true });
      } else if (error instanceof UpstreamError) {
        hub.push(run, {
          type: "error",
          message: redact(error.message),
          retryable: error.retryable,
        });
      } else if (error instanceof VersionMovedError) {
        hub.push(run, { type: "error", message: error.message, retryable: false });
      } else {
        this.deps.log(
          `回合出错：${redact(error instanceof Error ? (error.stack ?? error.message) : String(error))}`,
        );
        hub.push(run, { type: "error", message: "生成时出错，详情见后端日志", retryable: false });
      }
    }
  }

  private commit(
    run: TurnRun,
    plan: NarratorPlan,
    turn: NarratorTurn,
    usage: TurnUsage | undefined,
  ): Promise<{ seq: number; version: number }> {
    const { saves } = this.deps;
    return this.locks.run(run.saveId, async () => {
      const { records } = await saves.loadLog(run.saveId);
      const seq = logVersion(records);
      if (seq !== run.baseVersion)
        throw new VersionMovedError("存档在生成期间被改动，这一轮没有保存");
      const record: TurnRecord = {
        kind: "turn",
        seq,
        at: this.deps.clock.now().toISOString(),
        requestId: run.requestId,
        baseVersion: run.baseVersion,
        input: plan.input,
        dice:
          plan.kind === "resolve"
            ? [diceRules.diceRecord(plan.check.prepared, plan.check.result)]
            : [],
        commands: [...turn.commands],
        dropped: [...turn.dropped],
        text: turn.text,
        patches: [...turn.patches],
        ...(turn.read !== undefined ? { read: turn.read } : {}),
        ...(turn.choices.length > 0 ? { choices: [...turn.choices] } : {}),
        ...(turn.voices.length > 0 ? { voices: [...turn.voices] } : {}),
        ...(turn.clutch ? { clutch: true } : {}),
        scene: turn.scene,
        ...(turn.title !== undefined ? { title: turn.title } : {}),
        ...(turn.closeup !== undefined ? { closeup: turn.closeup } : {}),
        ...(turn.check !== undefined ? { check: turn.check } : {}),
        ...(plan.kind === "resolve" ? { resolves: plan.check.offer.id } : {}),
        ...(turn.ooc ? { ooc: true } : {}),
        ...(turn.notes.length > 0 ? { notes: [...turn.notes] } : {}),
        ...(turn.unsettled !== undefined ? { unsettled: turn.unsettled } : {}),
        ...(turn.considered.length > 0 ? { considered: [...turn.considered] } : {}),
        ...(turn.ruling !== undefined ? { ruling: turn.ruling } : {}),
        ...(turn.flags.length > 0 ? { flags: [...turn.flags] } : {}),
        ...(turn.offscreen !== undefined ? { offscreen: turn.offscreen } : {}),
        ...(turn.offscreenSkip !== undefined ? { offscreenSkip: turn.offscreenSkip } : {}),
        ...(turn.summary !== undefined ? { summary: turn.summary } : {}),
        ...(turn.decided.length > 0 ? { decided: [...turn.decided] } : {}),
        ...(turn.recalled.length > 0
          ? { recalled: turn.recalled.map((m) => ({ title: m.title, text: m.text })) }
          : {}),
        ...(turn.expanded.length > 0
          ? { expanded: turn.expanded.map((m) => ({ title: m.title, text: m.text })) }
          : {}),
        ...(turn.retrieval !== undefined
          ? {
              retrieval: {
                triggers: [...turn.retrieval.triggers],
                top: turn.retrieval.top.map((t) => ({ ...t })),
                fallback: [...turn.retrieval.fallback],
              },
            }
          : {}),
        ...(turn.lore !== undefined
          ? {
              lore: {
                terms: [...turn.lore.terms],
                picked: turn.lore.picked.map((p) => ({ ...p, hits: [...p.hits] })),
                candidates: turn.lore.candidates,
                ...(turn.lore.note !== undefined ? { note: turn.lore.note } : {}),
                ...(turn.lore.section !== undefined ? { section: turn.lore.section } : {}),
              },
            }
          : {}),
        budget: {
          ...turn.budget,
          parts: turn.budget.parts.map((p) => ({ ...p })),
          cuts: [...turn.budget.cuts],
        },
        ...(turn.modules.length > 0 ? { modules: [...turn.modules] } : {}),
        ...(usage ? { usage } : {}),
      };
      await saves.appendLog(run.saveId, serializeRecord(record));
      const version = seq + 1;
      await this.maybeSnapshot(run.saveId, version);
      return { seq, version };
    });
  }

  /** 调用方持有这个存档的锁 */
  private async maybeSnapshot(id: string, version: number): Promise<void> {
    if (version % SNAPSHOT_EVERY !== 0) return;
    const { world } = await this.load(id);
    await this.deps.saves.writeSnapshot(id, { nextSeq: version, world });
  }

  /** 调用方持有这个存档的锁 */
  private async load(id: string): Promise<Loaded> {
    const { saves } = this.deps;
    const meta = await saves.readMeta(id);
    const log = await saves.loadLog(id);
    if (log.droppedPartialTail) this.deps.log(`存档 ${id} 的回合日志末尾有半行，已经截掉`);
    const snapshot = pickSnapshot(await saves.readSnapshots(id), log.records) ?? {
      nextSeq: 0,
      world: newGameWorld(meta, gameContent),
    };
    return {
      meta,
      records: log.records,
      world: replay({ ...snapshot, world: withAllSlices(snapshot.world) }, log.records),
    };
  }
}

/** 上下文查看器里一步的提示词 */
interface StagePrompt {
  readonly stage: "judge" | "narrate" | "extract" | "offscreen" | "summary";
  readonly label: string;
  readonly messages: LlmMessage[];
  readonly modules: string[];
  readonly chars: number;
}

/** 夜之城难度死亡后重来：基于哪个日志版本 */
export const RestartRequestSchema = z.object({ baseVersion: z.number().int().min(0) });

/** 重新生成最后一轮：基于哪个日志版本 */
/** 按账目改写最多等这么久 */
const REWRITE_TIMEOUT_MS = 120_000;

export const RegenerateRequestSchema = z.object({ baseVersion: z.number().int().min(0) });

/** 角色死了就不能再提交回合和操作 */
function deathBlock(
  world: WorldState,
  records: readonly LogRecord[],
  version: number,
): Reply | undefined {
  const { death } = projectState(world, records, gameData);
  if (!death) return undefined;
  return {
    status: 409,
    body: {
      error: death.canRestart
        ? "角色已经死亡：可以从这个场景开头重来一次"
        : "角色已经死亡，这份存档到此为止，只能回看",
      death,
      version,
    },
  };
}
