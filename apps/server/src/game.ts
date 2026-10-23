import { randomBytes } from "node:crypto";
import {
  type Clock,
  type LogRecord,
  logVersion,
  newGameWorld,
  type PlayerView,
  pickSnapshot,
  projectState,
  replay,
  type SaveMeta,
  serializeRecord,
  type TurnInput,
  type TurnRecord,
  type TurnRequest,
  type TurnUsage,
  type WorldState,
  worldRules,
} from "@cp/core";
import { z } from "zod";
import type { ConfigService } from "./config";
import { KeyedMutex } from "./fsutil";
import { buildMessages } from "./prompt";
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

/**
 * 存档和回合：同一存档的读写都排在一把锁里。
 * 一轮的顺序是 校验 → 登记进行中 → 调模型（锁外） → 加锁追加回合日志；
 * 被拦截、停止或出错的轮次不写日志，存档保持原样
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
      if (request.baseVersion !== version) {
        return { status: 409, body: { error: "存档已经更新过，请刷新后再提交", version } };
      }
      const resolved = await this.deps.llm.resolve("gm");
      if (!resolved.ok) {
        const redact = await this.deps.config.redactor();
        return { status: 503, body: { error: redact(resolved.error) } };
      }
      const run = hub.start(id, request.requestId, request.baseVersion);
      void this.execute(run, projectState(world, records), request.input);
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

  private async execute(run: TurnRun, view: PlayerView, input: TurnInput): Promise<void> {
    const { hub } = this.deps;
    const redact = await this.deps.config.redactor();
    const signal = run.controller.signal;
    let text = "";
    let usage: TurnUsage | undefined;
    try {
      for await (const event of this.deps.llm.stream(
        { purpose: "gm", messages: buildMessages(view, input) },
        signal,
      )) {
        if (event.type === "text") {
          text += event.text;
          hub.push(run, { type: "text", text: event.text });
        } else if (event.type === "blocked") {
          hub.push(run, { type: "blocked", reason: redact(event.reason) });
          return;
        } else if (event.usage) {
          usage = event.usage;
        }
      }
      if (signal.aborted) throw new AbortedError();
      if (text.trim() === "")
        throw new UpstreamError("主持人没有返回正文，可以重试", undefined, true);
      const saved = await this.commit(run, input, text);
      hub.push(run, { type: "done", ...saved, ...(usage ? { usage } : {}) });
    } catch (error) {
      if (error instanceof AbortedError || signal.aborted) {
        hub.push(run, { type: "stopped" });
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
    input: TurnInput,
    text: string,
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
        input,
        dice: [],
        commands: [],
        dropped: [],
        text,
        patches: [],
      };
      await saves.appendLog(run.saveId, serializeRecord(record));
      const version = seq + 1;
      if (version % SNAPSHOT_EVERY === 0) {
        const { world } = await this.load(run.saveId);
        await saves.writeSnapshot(run.saveId, { nextSeq: version, world });
      }
      return { seq, version };
    });
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
