import { randomBytes } from "node:crypto";
import {
  type CheckRecord,
  type Clock,
  currentOffers,
  diceRules,
  GmAbortedError,
  GmEmptyReplyError,
  type GmPlan,
  type GmTurn,
  type LogRecord,
  logVersion,
  newGameWorld,
  type PlayerView,
  pickSnapshot,
  prepareFor,
  projectState,
  type Rng,
  replay,
  rolledFrom,
  runGmTurn,
  type SaveMeta,
  serializeRecord,
  type TurnRecord,
  type TurnRequest,
  type TurnUsage,
  type WorldState,
  worldRules,
} from "@cp/core";
import { z } from "zod";
import type { ConfigService } from "./config";
import { KeyedMutex } from "./fsutil";
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

/** 路由直接把 body 按 status 返回 */
export interface Reply {
  readonly status: 200 | 201 | 202 | 404 | 409 | 503;
  readonly body: Record<string, unknown>;
}

export interface GameDeps {
  readonly saves: SaveStore;
  readonly config: ConfigService;
  readonly llm: LlmRouter;
  readonly hub: TurnHub;
  readonly clock: Clock;
  /** 玩家检定用的骰子 */
  readonly rng: Rng;
  readonly log: (message: string) => void;
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
 * 行动的顺序是 校验 → 登记进行中 → 调主持人（锁外） → 加锁追加回合日志；
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
    const id = `s-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
    const meta: SaveMeta = { ...input, createdAt: this.deps.clock.now().toISOString() };
    await this.deps.saves.create(id, meta);
    return { status: 201, body: { id, ...meta } };
  }

  async state(id: string): Promise<PlayerView> {
    return this.locks.run(id, async () => {
      const { world, records } = await this.load(id);
      return projectState(world, records);
    });
  }

  submit(id: string, request: TurnRequest): Promise<Reply> {
    const { hub } = this.deps;
    return this.locks.run(id, async (): Promise<Reply> => {
      const { world, records } = await this.load(id);
      const version = logVersion(records);
      const done = records.find((r) => r.kind === "turn" && r.requestId === request.requestId);
      if (done) return { status: 200, body: { duplicate: true, seq: done.seq, version } };
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

        let log = records;
        let faces: readonly number[];
        let baseVersion = version;
        if (rolled) {
          faces = rolled.record.roll.faces;
        } else {
          const prepared = prepareFor(world, offer.spec);
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
        const check = rolledFrom(world, offer, faces);
        const plan: GmPlan = {
          kind: "resolve",
          input: { mode: "do", text: offer.label },
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
        void this.execute(run, world, log, plan);
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
      const unavailable = await this.llmUnavailable();
      if (unavailable) return unavailable;
      const run = hub.start(id, request.requestId, version);
      void this.execute(run, world, records, { kind: "action", input: request.input });
      return { status: 202, body: { turnId: run.turnId, replayed: false } };
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

  /** 主持人模型没配好时直接告诉玩家，不换别的服务商 */
  private async llmUnavailable(): Promise<Reply | undefined> {
    const resolved = await this.deps.llm.resolve("gm");
    if (resolved.ok) return undefined;
    const redact = await this.deps.config.redactor();
    return { status: 503, body: { error: redact(resolved.error) } };
  }

  private async execute(
    run: TurnRun,
    world: WorldState,
    records: readonly LogRecord[],
    plan: GmPlan,
  ): Promise<void> {
    const { hub } = this.deps;
    const redact = await this.deps.config.redactor();
    const signal = run.controller.signal;
    try {
      const result = await runGmTurn(
        {
          llm: this.deps.llm,
          rng: this.deps.rng,
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
      if (signal.aborted) throw new GmAbortedError("已停止");
      const { turn } = result;
      const usage = addUsage(turn.usage, turn.repairUsage);
      const saved = await this.commit(run, plan, turn, usage);
      if (turn.repairs > 0) {
        this.deps.log(`存档 ${run.saveId} 第 ${saved.seq} 轮修了 ${turn.repairs} 次指令格式`);
      }
      hub.push(run, { type: "done", ...saved, ...(usage ? { usage } : {}) });
    } catch (error) {
      if (error instanceof GmAbortedError || error instanceof AbortedError || signal.aborted) {
        hub.push(run, { type: "stopped" });
      } else if (error instanceof GmEmptyReplyError) {
        hub.push(run, { type: "error", message: "主持人没有返回正文，可以重试", retryable: true });
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
    plan: GmPlan,
    turn: GmTurn,
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
        ...(turn.check !== undefined ? { check: turn.check } : {}),
        ...(plan.kind === "resolve" ? { resolves: plan.check.offer.id } : {}),
        ...(turn.notes.length > 0 ? { notes: [...turn.notes] } : {}),
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
      world: newGameWorld(meta),
    };
    return { meta, records: log.records, world: replay(snapshot, log.records) };
  }
}
