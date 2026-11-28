import {
  DEFAULT_LOADOUT,
  DEFAULT_OPENING,
  type OpeningContext,
  openingPremise,
  RADAR_ANCHORS,
} from "@cp/content";
import {
  type ActionRecord,
  type ActionRequest,
  applyPlayerAction,
  applyRecordPatches,
  boardStart,
  buildExtractPrompt,
  buildImageSceneContext,
  buildJudgePrompt,
  buildLedger,
  buildNarratorPrompt,
  buildRewritePrompt,
  type Clock,
  characterRules,
  checkpointSummaryOf,
  cityRules,
  collectPresentedContentMedia,
  commerceRules,
  type Embedder,
  effectiveTurns,
  extractEdgeLedgerState,
  HISTORY_TURNS,
  isSnapshotValid,
  judgeCandidates,
  LEDGER_TURNS,
  type LlmMessage,
  type LogRecord,
  loadoutText,
  logVersion,
  memoryPool,
  NarratorAbortedError,
  NarratorEmptyReplyError,
  type NarratorPlan,
  NarratorStageError,
  type NarratorTurn,
  NPC_OVERRIDES_MAX,
  newGameWorld,
  npcRules,
  OFFSCREEN_PACE_SCENES,
  OFFSCREEN_SYSTEM,
  type OffscreenPace,
  type PhoneChatRequest,
  type PlayerView,
  parseLog,
  phoneRules,
  pickLoadouts,
  pickSnapshot,
  pickStartLocation,
  projectState,
  type Rng,
  registry,
  replay,
  rewriteNarrative,
  runNarratorTurn,
  runPhoneChat,
  type SaveMeta,
  SaveMetaSchema,
  type Snapshot,
  SUMMARY_SYSTEM,
  safehouseRules,
  sandevistanBlock,
  saveCharacter,
  sceneStartSeq,
  serializeRecord,
  type TurnCheckpoint,
  type TurnCheckpointSummary,
  TurnInputSchema,
  type TurnRecord,
  type TurnRequest,
  type TurnStage,
  type TurnUsage,
  travelBlock,
  travelRules,
  turnInputKey,
  type VoidRecord,
  validatePhoneChatTarget,
  voidedSeqs,
  type WorldState,
  withAllSlices,
  worldRules,
} from "@cp/core";
import { z } from "zod";
import type { CharacterStore } from "./characters";
import type { TurnCheckpointStore } from "./checkpoints";
import type { ConfigService } from "./config";
import type { EmbeddingCacheStore } from "./embedding-cache";
import type { ImageStore } from "./images";
import { KeyedMutex } from "./mutex";
import { SaveMovedError, type SaveStorage } from "./ports";
import type { PresetStore } from "./presets";
import { AbortedError, UpstreamError } from "./providers/http";
import type { LlmRouter } from "./providers/index";
import { randomHex } from "./random";
import type { TurnHub, TurnRun } from "./turns";
import type { WorkshopStore } from "./workshop";
import { requiredPackIds, workshopRuntime } from "./workshop-content";
import type { WorldbookStore } from "./worldbooks";

/** 每追加这么多条记录写一次快照 */
export const SNAPSHOT_EVERY = 10;
export const DEFAULT_START = "2077-04-12 21:00";

export const CreateSaveSchema = z.strictObject({
  title: z.string().trim().min(1, "存档名不能为空").max(80, "存档名最多 80 字"),
  characterId: z.string().min(1),
  /** 开场时间，格式 YYYY-MM-DD HH:mm；没给时用 DEFAULT_START（prefault 先填默认文本再解析） */
  startTime: worldRules.GameTimeSchema.prefault(DEFAULT_START),
  /**
   * 开局地点：原作固定地点 id，或原作地标 ft:、服务点 poi:（用户定的，2026-10-30："可以选择地点开局"，"在地图上选择"）。
   * 不给时照旧用开场自带的丽姿酒吧；建档时按地图数据校验，对不上的拒收
   */
  startLocation: z.string().trim().min(1).max(80).optional(),
  /** 全局本地改写过的原作/世界 NPC 卡面（优先级低于角色卡自身专属覆写） */
  npcOverrides: z.array(npcRules.NpcCardSchema).max(NPC_OVERRIDES_MAX).optional(),
  /** 全局本地自建 NPC 卡面（开新档自动加入世界，不覆盖同 id 已有角色） */
  customNpcs: z.array(npcRules.NpcCardSchema).max(NPC_OVERRIDES_MAX).optional(),
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

/** 导入不能只确认补丁能执行：最终每块系统状态都必须能被当前版本读取。 */
function validateImportedWorld(world: WorldState): void {
  const shape = ImportedSnapshotSchema.shape.world.safeParse(world);
  if (!shape.success) throw new Error(`世界状态结构不合法：${shape.error.message}`);
  const known = new Set(registry.order.map((system) => system.id));
  for (const id of Object.keys(world.slices)) {
    if (!known.has(id)) throw new Error(`世界状态包含当前版本不支持的系统：${id}`);
  }
  for (const system of registry.order) {
    const state = system.state.safeParse(world.slices[system.id]);
    if (!state.success) {
      throw new Error(`系统 ${system.id} 的状态不合法：${state.error.message}`);
    }
  }
}

/** 改写沿用原回合的结算；它的结算前世界应追溯到最初被改写的回合。 */
function originalTurnSeq(record: TurnRecord, records: readonly LogRecord[]): number {
  let original = record;
  while (original.replaces !== undefined) {
    const previous = records[original.replaces];
    if (previous?.kind !== "turn" || previous.seq >= original.seq) {
      throw new Error(`第 ${original.seq} 轮的改写来源不合法`);
    }
    original = previous;
  }
  return original.seq;
}

function openingContextOf(world: WorldState, startTime: number): OpeningContext {
  const char = characterRules.CharacterStateSchema.safeParse(world.slices.character);
  const safehouse = safehouseRules.SafehouseStateSchema.safeParse(world.slices.safehouse);
  const npcs = npcRules.NpcStateSchema.safeParse(world.slices.npc);
  const acquaintances = npcs.success
    ? Object.values(npcs.data.npcs)
        .filter((n) => n.met)
        .slice(0, 6)
        .map((n) => {
          const relation = n.relation?.text ?? n.role;
          return { name: n.name, ...(relation ? { relation } : {}) };
        })
    : [];
  return {
    timeMinutes: startTime,
    ...(char.success && char.data.brief ? { origin: char.data.brief.split("\n")[0] } : {}),
    ...(safehouse.success && safehouse.data.homes.length > 0
      ? { homes: safehouse.data.homes.map((h) => h.name) }
      : {}),
    ...(acquaintances.length > 0 ? { acquaintances } : {}),
  };
}

const newSaveId = () => `s-${Date.now().toString(36)}-${randomHex(3)}`;

/** 路由直接把 body 按 status 返回 */
export interface Reply {
  readonly status: 200 | 201 | 202 | 400 | 404 | 409 | 502 | 503;
  readonly body: Record<string, unknown>;
}

export interface GameDeps {
  readonly saves: SaveStorage;
  readonly characters: CharacterStore;
  readonly config: ConfigService;
  readonly llm: LlmRouter;
  readonly hub: TurnHub;
  readonly clock: Clock;
  /** 初始细节与世界事件抽样，不结算玩家行动成败 */
  readonly rng: Rng;
  readonly log: (message: string) => void;
  /** 玩家导入的酒馆预设（用户定的）：每轮开始时读当前启用的那一份，只给写正文 */
  readonly presets?: PresetStore | undefined;
  /** 玩家导入的酒馆世界书（可同时启用多本）：每轮开始时读全部启用中的世界书，只给写正文 */
  readonly worldbooks?: WorldbookStore | undefined;
  /** 回合阶段断点存储：每步调用完成后落盘，防止报错重头再来 */
  readonly checkpoints?: TurnCheckpointStore | undefined;
  /** 本地持久化向量缓存：按存档缓存旧记忆文档向量 */
  readonly embeddingCache?: EmbeddingCacheStore | undefined;
  /** 本地图片绑定存储：删档时顺手清理该存档的图片绑定 */
  readonly images?: ImageStore | undefined;
  readonly workshop?: WorkshopStore | undefined;
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
  const cached = (a?.cachedInputTokens ?? 0) + (b.cachedInputTokens ?? 0);
  const write = (a?.cacheWriteTokens ?? 0) + (b.cacheWriteTokens ?? 0);
  return {
    inputTokens: (a?.inputTokens ?? 0) + b.inputTokens,
    outputTokens: (a?.outputTokens ?? 0) + b.outputTokens,
    ...(cached > 0 ? { cachedInputTokens: cached } : {}),
    ...(write > 0 ? { cacheWriteTokens: write } : {}),
  };
}

/**
 * 存档和回合：同一存档的读写都排在一把锁里。
 * 行动的顺序是 校验 → 登记进行中 → 调叙事模型（锁外） → 加锁追加回合日志；
 * 主动停止、无正文的失败或拦截不写回合；正文中断或整份抽取失败时保存零结算草稿。
 * 重试由 requestId 和版本核对防止重复写入。
 */
export class GameService {
  private readonly locks = new KeyedMutex();
  /** 后台异步向量预热的取消句柄：新一轮提交时立即中止，避免争抢资源或阻塞 */
  private readonly prewarmControllers = new Map<string, AbortController>();
  /** 确认绑定本次输入、存档版本和完整报价；重启或状态改变后需重新确认。 */
  private readonly pendingSpends = new Map<
    string,
    { version: number; input: string; quoteKey: string }
  >();

  constructor(private readonly deps: GameDeps) {}

  private cancelPrewarm(saveId: string): void {
    const prev = this.prewarmControllers.get(saveId);
    if (!prev) return;
    this.prewarmControllers.delete(saveId);
    prev.abort();
  }

  private runtime(meta: SaveMeta) {
    return workshopRuntime(
      meta.workshopPacks ?? [],
      meta.board?.customCyberware,
      meta.board?.kit?.customItems,
      // 进档的覆写/自建人物卡：身体里内嵌的自建装备与义体定义一并进目录
      [...(meta.board?.npcOverrides ?? []), ...(meta.board?.people ?? [])],
    );
  }

  async list(): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = [];
    for (const id of await this.deps.saves.list()) {
      try {
        const meta = await this.deps.saves.readMeta(id);
        out.push({ id, ...meta, running: this.deps.hub.running(id) !== undefined });
      } catch (error) {
        this.deps.log(
          `跳过无法解析的存档 ${id}（可能与当前版本格式不兼容或数据已损坏，可在读取存档页导入 JSON 备份）：${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return out;
  }

  async deleteSave(saveId: string): Promise<Reply> {
    return this.locks.run(saveId, async () => {
      if (this.deps.hub.running(saveId) !== undefined) {
        return { status: 409, body: { error: "这个存档正在生成回合，请先停止后再删除" } };
      }
      const removed = await this.deps.saves.remove(saveId);
      if (!removed) return { status: 404, body: { error: "没有这个存档" } };
      this.pendingSpends.delete(saveId);
      await Promise.all([
        this.deps.checkpoints?.clear(saveId).catch(() => undefined),
        this.deps.embeddingCache?.remove(saveId).catch(() => undefined),
        this.deps.images?.removeSaveBindings(saveId).catch(() => undefined),
      ]);
      return { status: 200, body: { ok: true } };
    });
  }

  async create(input: z.output<typeof CreateSaveSchema>): Promise<Reply> {
    // 开局地点“在地图上选择”：只收已有地图锚点，未传时优先取角色卡预设位置或出身默认起点
    if (
      input.startLocation !== undefined &&
      !RADAR_ANCHORS.some((anchor) => anchor.id === input.startLocation)
    ) {
      return { status: 400, body: { error: "开局地点不在可选的地图地点里，请重新选择" } };
    }
    const id = newSaveId();
    const entry = await this.deps.characters.get(input.characterId);
    if (!entry) return { status: 400, body: { error: "没有这个角色，先在角色页建一个" } };
    const installed = (await this.deps.workshop?.list()) ?? [];
    const required = requiredPackIds(entry.card.board);
    const missing = [...required].filter(
      (packId) => !installed.some((item) => item.pack.id === packId),
    );
    if (missing.length > 0) {
      return {
        status: 400,
        body: {
          error: `角色使用的内容包尚未安装：${missing.join("、")}。请先重新安装，或从角色卡移除相关内容。`,
        },
      };
    }
    const workshopPacks = installed
      .filter((item) => item.enabled || required.has(item.pack.id))
      .map((item) => item.pack);
    if (workshopPacks.length > 40) {
      return { status: 400, body: { error: "每份存档最多使用 40 个内容包，请先停用部分包。" } };
    }
    const baseStart = boardStart(entry.card);
    const globalOverrides = input.npcOverrides ?? [];
    const globalCustomNpcs = input.customNpcs ?? [];
    const start = (() => {
      if (globalOverrides.length === 0 && globalCustomNpcs.length === 0) return baseStart;
      const mergedOverridesMap = new Map<string, npcRules.NpcCard>();
      for (const card of globalOverrides) mergedOverridesMap.set(card.id, card);
      for (const card of baseStart?.npcOverrides ?? []) mergedOverridesMap.set(card.id, card);
      const existingPeople = [...(baseStart?.people ?? [])];
      const existingIds = new Set(existingPeople.map((p) => p.id));
      for (const card of globalCustomNpcs) {
        if (existingIds.has(card.id)) continue;
        existingIds.add(card.id);
        existingPeople.push({ ...card, canon: false, met: false, ledger: [] });
      }
      return {
        cyberware: baseStart?.cyberware ?? [],
        ...(baseStart?.cyberwareSides ? { cyberwareSides: baseStart.cyberwareSides } : {}),
        customCyberware: baseStart?.customCyberware ?? [],
        ...(baseStart?.origin ? { origin: baseStart.origin } : {}),
        ...(baseStart?.kit ? { kit: baseStart.kit } : {}),
        people: existingPeople,
        acquaintances: baseStart?.acquaintances ?? [],
        npcOverrides: [...mergedOverridesMap.values()].slice(0, NPC_OVERRIDES_MAX),
      };
    })();
    const runtime = workshopRuntime(
      workshopPacks,
      start?.customCyberware,
      start?.kit?.customItems,
      [
        // 全局与角色卡的覆写/自建人物卡都会进档：收集内嵌的自建装备与义体定义
        ...globalOverrides,
        ...globalCustomNpcs,
        ...(start?.npcOverrides ?? []),
        ...(start?.people ?? []),
      ],
    );
    const matchInput = loadoutText(entry.card);
    const cardStart = entry.card.board?.startLocation;
    const startLocation =
      input.startLocation ??
      (cardStart && RADAR_ANCHORS.some((anchor) => anchor.id === cardStart)
        ? cardStart
        : pickStartLocation(matchInput, runtime.content.loadouts ?? []));
    const { npcOverrides: _o, customNpcs: _c, ...saveInput } = input;
    const meta: SaveMeta = {
      ...saveInput,
      startLocation,
      createdAt: this.deps.clock.now().toISOString(),
      character: saveCharacter(entry.card),
      opening: DEFAULT_OPENING,
      loadouts: pickLoadouts(matchInput, runtime.content.loadouts ?? [], DEFAULT_LOADOUT),
      workshopPacks,
      ...(start ? { board: start } : {}),
    };
    try {
      newGameWorld(meta, runtime.content);
    } catch (error) {
      return {
        status: 400,
        body: { error: error instanceof Error ? error.message : "角色开局设定无法初始化" },
      };
    }
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
    if (!meta.success) {
      return {
        status: 400,
        body: { error: "存档信息（meta）格式不兼容或已损坏，无法导入当前版本" },
      };
    }
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
    const runtime = this.runtime(meta.data);
    try {
      world = replay(
        { nextSeq: 0, world: withAllSlices(newGameWorld(meta.data, runtime.content)) },
        records,
      );
      validateImportedWorld(world);
      projectState(world, records, runtime.data);
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
    await this.deps.saves.createImported(id, meta.data, records.map(serializeRecord), {
      nextSeq: records.length,
      world,
    });
    return { status: 201, body: { id, ...meta.data, notes } };
  }

  async state(id: string): Promise<PlayerView & { readonly checkpoint?: TurnCheckpointSummary }> {
    return this.locks.run(id, async () => {
      const { meta, world, records } = await this.load(id);
      // 撤销可能原子追加多条 void；不能截在这批记录中间重放，也不把撤销当成新事件通知。
      const before =
        records.length > 0 && records.at(-1)?.kind !== "void"
          ? await this.worldAt(id, meta, records.slice(0, -1))
          : undefined;
      const view = projectState(world, records, this.runtime(meta).data, before);
      const version = logVersion(records);
      const cp = await this.deps.checkpoints?.get(id);
      if (cp && cp.baseVersion === version) {
        return { ...view, checkpoint: checkpointSummaryOf(cp) };
      }
      return view;
    });
  }

  /** 主动放弃当前存档尚未完成的回合断点，下一次提交将从第 ① 步重新开始 */
  clearCheckpoint(id: string): Promise<Reply> {
    return this.locks.run(id, async (): Promise<Reply> => {
      if (this.deps.hub.running(id)) {
        return { status: 409, body: { error: "这一轮还在生成，等它结束再操作" } };
      }
      const cleared = (await this.deps.checkpoints?.clear(id)) ?? false;
      return { status: 200, body: { cleared } };
    });
  }

  submit(id: string, request: TurnRequest): Promise<Reply> {
    this.cancelPrewarm(id);
    const { hub } = this.deps;
    return this.locks.run(id, async (): Promise<Reply> => {
      const { meta, world, records } = await this.load(id);
      const runtime = this.runtime(meta);
      const version = logVersion(records);
      const done = records.find((r) => r.kind === "turn" && r.requestId === request.requestId);
      if (done) return { status: 200, body: { duplicate: true, seq: done.seq, version } };
      const dead = deathBlock(world, records, version, runtime.data);
      if (dead) return dead;
      const same = hub.byRequest(id, request.requestId);
      if (same) return { status: 202, body: { turnId: same.turnId, replayed: true } };
      const busy = hub.running(id);
      if (busy)
        return {
          status: 409,
          body: {
            error: "上一轮还在生成，先等它结束或停止",
            turnId: busy.turnId,
            input: busy.input,
            version,
          },
        };
      if (request.baseVersion !== version) {
        return { status: 409, body: { error: "存档已经更新过，请刷新后再提交", version } };
      }
      if (request.input.sandevistan) {
        const blocked = sandevistanBlock(world, records, runtime.data);
        if (blocked) return { status: 409, body: { error: blocked, version } };
      }
      if (request.input.travel !== undefined) {
        const blocked = travelBlock(world, runtime.data, request.input.travel);
        if (blocked) return { status: 409, body: { error: blocked, version } };
      }
      if (request.input.replyTo !== undefined) {
        const blocked = phoneRules.replyBlock(world, request.input.replyTo);
        if (blocked) return { status: 409, body: { error: blocked, version } };
      }
      const unavailable = await this.llmUnavailable();
      if (unavailable) return unavailable;
      const storedCheckpoint = await this.deps.checkpoints?.get(id);
      const inputKey = turnInputKey(request.input);
      const checkpoint =
        storedCheckpoint &&
        storedCheckpoint.baseVersion === version &&
        storedCheckpoint.inputKey === inputKey
          ? storedCheckpoint
          : undefined;
      const run = hub.start(id, request.requestId, version, request.input);
      void this.execute(
        run,
        world,
        records,
        runtime.data,
        { kind: "action", input: request.input },
        meta.opening,
        meta.startTime,
        request.offscreen,
        request.encounters,
        meta.startLocation,
        checkpoint,
      );
      return { status: 202, body: { turnId: run.turnId, replayed: false } };
    });
  }

  /** 界面操作（装备、交易、读消息等）：不调用模型，结算后写一条 action 记录 */
  action(id: string, request: ActionRequest): Promise<Reply> {
    return this.locks.run(id, async (): Promise<Reply> => {
      const { meta, world, records } = await this.load(id);
      const runtime = this.runtime(meta);
      const version = logVersion(records);
      const done = records.find((r) => r.kind === "action" && r.requestId === request.requestId);
      if (done) return { status: 200, body: { duplicate: true, seq: done.seq, version } };
      const dead = deathBlock(world, records, version, runtime.data);
      if (dead) return dead;
      if (this.deps.hub.running(id)) {
        return { status: 409, body: { error: "这一轮还在生成，等它结束再操作", version } };
      }
      if (request.baseVersion !== version) {
        return { status: 409, body: { error: "存档已经更新过，请刷新后再操作", version } };
      }
      const result = applyPlayerAction(world, request.action, {
        rng: this.deps.rng,
        data: runtime.data,
        facts: {
          memorySourceThrough: records.reduce((last, record) => Math.max(last, record.seq), -1),
        },
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
      try {
        await this.deps.saves.appendAt(id, version, serializeRecord(record));
      } catch (error) {
        if (!(error instanceof SaveMovedError)) throw error;
        return { status: 409, body: { error: error.message, version: error.actual } };
      }
      await this.clearCheckpointBestEffort(id);
      await this.maybeSnapshot(id, version + 1);
      return { status: 200, body: { seq: version, version: version + 1, notes: result.notes } };
    });
  }

  /** 手机窗口内轻量直聊：仅调辅助模型与双人窄上下文，推进 1–3 分钟游戏时钟并记入 action 日志 */
  async phoneChat(id: string, request: PhoneChatRequest): Promise<Reply> {
    const checked = await this.locks.run(
      id,
      async (): Promise<
        | { reply: Reply }
        | { world: WorldState; version: number; data: ReturnType<GameService["runtime"]>["data"] }
      > => {
        const { meta, world, records } = await this.load(id);
        const runtime = this.runtime(meta);
        const version = logVersion(records);
        const done = records.find((r) => r.kind === "action" && r.requestId === request.requestId);
        if (done) {
          return { reply: { status: 200, body: { duplicate: true, seq: done.seq, version } } };
        }
        const dead = deathBlock(world, records, version, runtime.data);
        if (dead) return { reply: dead };
        const refuse = (error: string): { reply: Reply } => ({
          reply: { status: 409, body: { error, version } },
        });
        if (this.deps.hub.running(id)) return refuse("这一轮还在生成，等它结束再发消息");
        if (request.baseVersion !== version) return refuse("存档已经更新过，请刷新后再发");
        const target = validatePhoneChatTarget(world, request.contact);
        if (!target.ok) return refuse(target.reason);
        return { world, version, data: runtime.data };
      },
    );
    if ("reply" in checked) return checked.reply;
    const { world, version, data } = checked;

    const redact = await this.deps.config.redactor();
    const aux = await this.deps.llm.resolve("aux");
    let purpose: "aux" | "narrator" = "aux";
    if (!aux.ok) {
      if (aux.error.startsWith("还没有选辅助模型")) {
        const unavailable = await this.llmUnavailable();
        if (unavailable) return unavailable;
        purpose = "narrator";
      } else {
        return { status: 503, body: { error: redact(aux.error) } };
      }
    }

    let chat: Awaited<ReturnType<typeof runPhoneChat>>;
    try {
      chat = await runPhoneChat(
        {
          llm: this.deps.llm,
          rng: this.deps.rng,
          data,
          purpose,
          signal: AbortSignal.timeout(PHONE_CHAT_TIMEOUT_MS),
        },
        world,
        request.contact,
        request.text,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { status: 502, body: { error: `消息发送失败：${redact(message)}`, version } };
    }
    if (!chat.ok) {
      return { status: chat.status, body: { error: redact(chat.reason), version } };
    }

    return this.locks.run(id, async (): Promise<Reply> => {
      const { records } = await this.load(id);
      const now = logVersion(records);
      const done = records.find((r) => r.kind === "action" && r.requestId === request.requestId);
      if (done) return { status: 200, body: { duplicate: true, seq: done.seq, version: now } };
      if (now !== version || this.deps.hub.running(id)) {
        return {
          status: 409,
          body: { error: "等待回复期间存档已有新的变化，这次私信未写入，请重发", version: now },
        };
      }
      const record: ActionRecord = {
        kind: "action",
        seq: version,
        at: this.deps.clock.now().toISOString(),
        requestId: request.requestId,
        action: { type: "phoneChat", contact: request.contact, text: request.text },
        commands: [...chat.commands],
        notes: [...chat.notes],
        patches: [...chat.patches],
      };
      try {
        await this.deps.saves.appendAt(id, version, serializeRecord(record));
      } catch (error) {
        if (!(error instanceof SaveMovedError)) throw error;
        return { status: 409, body: { error: error.message, version: error.actual } };
      }
      await this.clearCheckpointBestEffort(id);
      await this.maybeSnapshot(id, version + 1);
      return {
        status: 200,
        body: {
          seq: version,
          version: version + 1,
          notes: chat.notes,
          reply: chat.reply,
          minutes: chat.minutes,
        },
      };
    });
  }

  /**
   * 夜之城难度死亡后从这个场景开头重来：把场景开始以后的回合、掷骰和操作都作废，
   * 骰子之后重新掷；每个场景只能重来一次，作废记录就是履历里的“重来过”
   */
  restart(id: string, request: z.output<typeof RestartRequestSchema>): Promise<Reply> {
    return this.locks.run(id, async (): Promise<Reply> => {
      const { meta, world, records } = await this.load(id);
      const runtime = this.runtime(meta);
      const version = logVersion(records);
      if (this.deps.hub.running(id)) {
        return { status: 409, body: { error: "这一轮还在生成，等它结束再操作", version } };
      }
      if (request.baseVersion !== version) {
        return { status: 409, body: { error: "存档已经更新过，请刷新后再操作", version } };
      }
      const view = projectState(world, records, runtime.data);
      if (!view.death) return { status: 409, body: { error: "角色还活着，不用重来", version } };
      if (!view.death.canRestart) {
        return {
          status: 409,
          body: {
            error: "这个场景已经重来过一次，这一次是真的死了",
            version,
          },
        };
      }
      const start = sceneStartSeq(newGameWorld(meta, runtime.content), records);
      const voided = voidedSeqs(records);
      const targets = records.filter(
        (r) => r.seq >= start && r.kind !== "void" && !voided.has(r.seq),
      );
      const at = this.deps.clock.now().toISOString();
      const lines = targets.map((target, index) => {
        const record: VoidRecord = {
          kind: "void",
          seq: version + index,
          at,
          target: target.seq,
          reason: "restart",
          scene: view.scene,
        };
        return serializeRecord(record);
      });
      try {
        await this.deps.saves.appendManyAt(id, version, lines);
      } catch (error) {
        if (!(error instanceof SaveMovedError)) throw error;
        return { status: 409, body: { error: error.message, version: error.actual } };
      }
      await this.clearCheckpointBestEffort(id);
      return { status: 200, body: { version: version + targets.length, voided: targets.length } };
    });
  }

  /**
   * 重新生成最后一轮：把它作废（reason regenerate），返回当时的玩家输入，
   * 网页再按输入提交流程重发。
   */
  regenerate(id: string, request: z.output<typeof RegenerateRequestSchema>): Promise<Reply> {
    return this.locks.run(id, async (): Promise<Reply> => {
      const { meta, world, records } = await this.load(id);
      const runtime = this.runtime(meta);
      const version = logVersion(records);
      if (this.deps.hub.running(id)) {
        return { status: 409, body: { error: "这一轮还在生成，等它结束再操作", version } };
      }
      if (request.baseVersion !== version) {
        return { status: 409, body: { error: "存档已经更新过，请刷新后再操作", version } };
      }
      if (projectState(world, records, runtime.data).death) {
        return { status: 409, body: { error: "角色已经死了，不能重新生成", version } };
      }
      const voided = voidedSeqs(records);
      const latestTurn = effectiveTurns(records).at(-1);
      if (!latestTurn) {
        return { status: 409, body: { error: "还没有可以重新生成的回合", version } };
      }
      const input = TurnInputSchema.safeParse(latestTurn.input);
      if (!input.success) {
        return { status: 409, body: { error: "这一轮的输入读不出来，不能重新生成", version } };
      }
      const targets =
        latestTurn.draft === true && latestTurn.patches.length === 0
          ? [latestTurn]
          : records.filter(
              (r) => r.seq >= latestTurn.seq && r.kind !== "void" && !voided.has(r.seq),
            );
      const at = this.deps.clock.now().toISOString();
      const lines = targets.map((target, index) => {
        const record: VoidRecord = {
          kind: "void",
          seq: version + index,
          at,
          target: target.seq,
          reason: "regenerate",
        };
        return serializeRecord(record);
      });
      try {
        await this.deps.saves.appendManyAt(id, version, lines);
      } catch (error) {
        if (!(error instanceof SaveMovedError)) throw error;
        return { status: 409, body: { error: error.message, version: error.actual } };
      }
      await this.clearCheckpointBestEffort(id);
      const pending = { kind: "input", input: input.data };
      return {
        status: 200,
        body: { version: version + targets.length, voided: latestTurn.seq, pending },
      };
    });
  }

  /**
   * 删楼（撤销指定回合及之后的所有有效记录）：把 fromSeq 及之后的回合、界面操作与后台记录一并作废，
   * 并将该回合的原始玩家输入返回给前端，便于玩家直接修改后再发或放弃。
   */
  undoTurn(id: string, request: z.output<typeof UndoTurnRequestSchema>): Promise<Reply> {
    return this.locks.run(id, async (): Promise<Reply> => {
      const { meta, world, records } = await this.load(id);
      const runtime = this.runtime(meta);
      const version = logVersion(records);
      if (this.deps.hub.running(id)) {
        return { status: 409, body: { error: "这一轮还在生成，等它结束再删楼", version } };
      }
      if (request.baseVersion !== version) {
        return { status: 409, body: { error: "存档已经更新过，请刷新后再操作", version } };
      }
      const view = projectState(world, records, runtime.data);
      if (view.ended && !view.death) {
        return { status: 409, body: { error: "这个角色的故事已经结束，不能删楼", version } };
      }
      const voided = voidedSeqs(records);
      const effective = effectiveTurns(records);
      const targetTurn =
        request.fromSeq !== undefined
          ? effective.find((t) => t.seq === request.fromSeq)
          : effective.at(-1);
      if (!targetTurn) {
        return { status: 404, body: { error: "找不到要删除的那一楼（可能已被撤销）", version } };
      }
      const targets =
        targetTurn.draft === true &&
        targetTurn.patches.length === 0 &&
        targetTurn.seq === effective.at(-1)?.seq
          ? [targetTurn]
          : records.filter(
              (r) => r.seq >= targetTurn.seq && r.kind !== "void" && !voided.has(r.seq),
            );
      const at = this.deps.clock.now().toISOString();
      const lines = targets.map((target, index) => {
        const record: VoidRecord = {
          kind: "void",
          seq: version + index,
          at,
          target: target.seq,
          reason: "undo",
        };
        return serializeRecord(record);
      });
      try {
        await this.deps.saves.appendManyAt(id, version, lines);
      } catch (error) {
        if (!(error instanceof SaveMovedError)) throw error;
        return { status: 409, body: { error: error.message, version: error.actual } };
      }
      await this.clearCheckpointBestEffort(id);
      const parsedInput = TurnInputSchema.safeParse(targetTurn.input);
      return {
        status: 200,
        body: {
          version: version + targets.length,
          voided: targets.length,
          fromSeq: targetTurn.seq,
          ...(parsedInput.success ? { input: parsedInput.data } : {}),
        },
      };
    });
  }

  /**
   * 按账目改写最后一轮：只按已经结算的账目重写正文，不改状态。
   * 和回合一样：锁里校验 → 锁外调叙事模型 → 锁里确认存档没动过再追加；
   * 追加的回合照抄指令和状态变化，只换正文，用 replaces 一行替换掉原来那一轮
   */
  async rewrite(id: string, request: z.output<typeof RegenerateRequestSchema>): Promise<Reply> {
    const checked = await this.locks.run(
      id,
      async (): Promise<{ reply: Reply } | { last: TurnRecord; version: number }> => {
        const { meta, world, records } = await this.load(id);
        const runtime = this.runtime(meta);
        const version = logVersion(records);
        const refuse = (error: string): { reply: Reply } => ({
          reply: { status: 409, body: { error, version } },
        });
        if (this.deps.hub.running(id)) return refuse("这一轮还在生成，等它结束再操作");
        if (request.baseVersion !== version) return refuse("存档已经更新过，请刷新后再操作");
        if (projectState(world, records, runtime.data).death)
          return refuse("角色已经死了，不能改写");
        const voided = voidedSeqs(records);
        const last = records.findLast((r) => r.kind !== "void" && !voided.has(r.seq));
        if (last?.kind !== "turn") {
          return refuse("最后一步不是可以改写的回合（之后可能有别的操作）");
        }
        if (last.unsettled === undefined) return refuse("这一轮的正文和账目对得上，不用改写");
        if (last.draft)
          return refuse(
            "这一轮是尚未完成生成或记账的草稿，请使用重新生成；没有已结算账目可供改写。",
          );
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
      try {
        // 写回前核对（第 4 项）：条数对不上就什么都不写，不自动重试
        await this.deps.saves.appendAt(id, version, serializeRecord(record));
      } catch (error) {
        if (!(error instanceof SaveMovedError)) throw error;
        return { status: 409, body: { error: error.message, version: error.actual } };
      }
      await this.clearCheckpointBestEffort(id);
      return { status: 200, body: { version: version + 1, replaced: last.seq } };
    });
  }

  stop(id: string, turnId: string): Reply {
    const run = this.deps.hub.get(id, turnId);
    if (!run) return { status: 404, body: { error: "没有这一轮，可能已经过期" } };
    if (run.finishedAt !== null) {
      if (run.events.at(-1)?.type === "stopped") {
        return { status: 200, body: { stopping: true, stopped: true } };
      }
      return { status: 409, body: { error: "这一轮已经结束", result: run.events.at(-1)?.type } };
    }
    run.controller.abort();
    // 尚未进入不可逆落盘前立即向事件流宣告停止，不让上游连接关闭延迟拖住前端
    if (!run.committing) {
      this.deps.hub.push(run, { type: "stopped" });
    }
    return { status: 202, body: { stopping: true } };
  }

  /**
   * 上下文查看器：第 seq 轮的规则模块、被丢弃的指令、token 用量，
   * 以及按回合日志重建的这一轮发给叙事模型的内容（不含格式修复的那次调用）
   */
  context(id: string, seq: number): Promise<Reply> {
    return this.locks.run(id, async (): Promise<Reply> => {
      const meta = await this.deps.saves.readMeta(id);
      const runtime = this.runtime(meta);
      const { records } = await this.deps.saves.loadLog(id);
      const record = records[seq];
      if (record?.kind !== "turn" || !effectiveTurns(records).includes(record)) {
        return { status: 404, body: { error: `没有第 ${seq} 轮` } };
      }
      const before = records.slice(0, originalTurnSeq(record, records));
      const upto = records.slice(0, seq + 1);
      const world = await this.worldAt(id, meta, before);
      const input = TurnInputSchema.safeParse(record.input);
      let prompts: StagePrompt[] = [];
      let rebuildError: string | null = null;
      try {
        if (record.replaces !== undefined) {
          const previous = records[record.replaces];
          if (previous?.kind !== "turn") throw new Error("改写前的回合记录不存在");
          const messages = buildRewritePrompt(previous);
          prompts.push({
            stage: "narrate",
            label: "③ 按账目改写",
            messages,
            modules: [],
            chars: messages.reduce((n, message) => n + message.content.length, 0),
          });
        } else {
          if (!input.success) throw new Error("这一轮的玩家输入格式不对");
          const plan: NarratorPlan = { kind: "action", input: input.data };
          const extras = {
            data: runtime.data,
            opening: openingPremise(
              meta.opening,
              meta.startLocation,
              openingContextOf(world, meta.startTime),
            ),
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
          const boosted = record.commands.some(
            (c) =>
              typeof c === "object" &&
              c !== null &&
              (c as { type?: unknown }).type === "cyberware.boost",
          );
          const livePlan: NarratorPlan =
            plan.kind === "action" && boosted && plan.input.sandevistan !== true
              ? { ...plan, input: { ...plan.input, sandevistan: true } }
              : plan;
          prompts.push(
            stage(
              "narrate",
              record.decided === undefined
                ? "③ 写正文（旧存档没记已定的事，只是大致还原）"
                : "③ 写正文",
              buildNarratorPrompt(world, before, livePlan, {
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
          if (record.ooc !== true) {
            prompts.push(
              stage(
                "extract",
                "④ 抽取",
                buildExtractPrompt(
                  world,
                  before,
                  livePlan,
                  { ...extras, decided: record.decided },
                  record.text,
                ),
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
        }
      } catch (error) {
        prompts = [];
        rebuildError = error instanceof Error ? error.message : String(error);
      }
      const narrate = prompts.find((p) => p.stage === "narrate");
      const prompt = narrate ? { messages: narrate.messages, modules: narrate.modules } : null;
      const total = {
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        turns: 0,
      };
      for (const turn of effectiveTurns(records)) {
        if (!turn.usage) continue;
        total.inputTokens += turn.usage.inputTokens;
        total.outputTokens += turn.usage.outputTokens;
        total.cachedInputTokens += turn.usage.cachedInputTokens ?? 0;
        total.cacheWriteTokens += turn.usage.cacheWriteTokens ?? 0;
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
          modules: record.replaces === undefined ? (record.modules ?? []) : [],
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
          offscreenSkip:
            record.replaces !== undefined
              ? "按账目改写只修改正文，不执行场外推演"
              : record.offscreen
                ? null
                : (record.offscreenSkip ??
                  (record.ooc ? "场外提问，不推演" : "尚未触发需要推演的世界变化")),
          // 这一轮结算之后城里的动静（含已结束的），只在剧透视图里看
          city: cityRules.CityStateSchema.parse(
            applyRecordPatches(world, record.patches).slices.city ?? {},
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
          ledger: await (async () => {
            const ledgerStart = effectiveTurns(upto).slice(-LEDGER_TURNS)[0]?.seq ?? 0;
            const base = await this.snapshotFor(id, meta, upto, ledgerStart);
            return buildLedger(base, upto);
          })(),
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
   * 连同当时的回复构建成用例草稿 JSON 返回给网页下载；补上期望后可放进 tools/evals/ 进测评
   */
  evalDraft(id: string, seq: number): Promise<Reply> {
    return this.locks.run(id, async (): Promise<Reply> => {
      const meta = await this.deps.saves.readMeta(id);
      const { records } = await this.deps.saves.loadLog(id);
      const record = records[seq];
      const effective = effectiveTurns(records);
      if (
        record?.kind !== "turn" ||
        (!effective.includes(record) &&
          !effective.some((turn) => originalTurnSeq(turn, records) === seq))
      ) {
        return { status: 404, body: { error: `没有第 ${seq} 轮` } };
      }
      if (record.replaces !== undefined) {
        const originalSeq = originalTurnSeq(record, records);
        const alternative = `/api/saves/${id}/turns/${originalSeq}/eval-case`;
        return {
          status: 409,
          body: {
            error: `第 ${seq} 轮是按账目改写，当前评测器只支持普通回合。请改为导出原第 ${originalSeq} 轮：${alternative}`,
            originalSeq,
            alternative,
          },
        };
      }
      const input = TurnInputSchema.safeParse(record.input);
      if (!input.success) return { status: 400, body: { error: "这一轮的玩家输入格式不对" } };
      const before = records.slice(0, seq);
      const ask = { input: input.data };
      const world = await this.worldAt(id, meta, before);
      const opening = openingPremise(
        meta.opening,
        meta.startLocation,
        openingContextOf(world, meta.startTime),
      );
      const caseId = `playtest-${id}-${seq}`;
      const draft = {
        id: caseId,
        title: `试玩「${meta.title}」第 ${seq} 轮：写清这一轮哪里不对`,
        tags: ["playtest"],
        setup: {
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
      return { status: 200, body: { id: caseId, fileName: `${caseId}.json`, draft } };
    });
  }

  /**
   * 导出单个存档的脱敏诊断快照（无需打开剧透开关）：
   * 包含全部世界状态切片（35+ 子系统）、聚合核心状态、最近 N 轮全链路记录（含检定/骰子/召回/检索/守则提醒/抽取考量）、
   * 界面操作、当前活跃报价与挂起断点，勾选时还附带最后一轮全阶段提示词，覆盖全游戏各类 bug 排查。
   */
  diagnostics(
    id: string,
    options: {
      readonly turns?: number;
      readonly includeThought?: boolean;
      readonly includePrompt?: boolean;
      readonly includeWorldState?: boolean;
    } = {},
  ): Promise<Record<string, unknown>> {
    return this.locks.run(id, async () => {
      const { meta, world, records } = await this.load(id);
      const runtime = this.runtime(meta);
      const view = projectState(world, records, runtime.data);
      const clock = worldRules.WorldClockStateSchema.safeParse(world.slices.world);
      const commerce = commerceRules.CommerceStateSchema.safeParse(world.slices.commerce ?? {});
      const storedCheckpoint = await this.deps.checkpoints?.get(id);
      const checkpoint =
        storedCheckpoint && storedCheckpoint.baseVersion === logVersion(records)
          ? checkpointSummaryOf(storedCheckpoint)
          : null;

      const limit = Math.max(1, Math.min(30, Math.floor(options.turns ?? 10)));
      const includeThought = options.includeThought !== false;
      const includePrompt = options.includePrompt === true;
      const includeWorldState = options.includeWorldState !== false;
      const turns = effectiveTurns(records);
      const slicedTurns = turns.slice(-limit);
      const seqMap = new Map<TurnRecord, number>();
      let voidedCount = 0;
      let actionCount = 0;
      for (let i = 0; i < records.length; i += 1) {
        const rec = records[i];
        if (rec?.kind === "turn") seqMap.set(rec, i);
        else if (rec?.kind === "action") actionCount += 1;
        else if (rec?.kind === "void") voidedCount += 1;
      }
      const firstSeq = slicedTurns[0] ? (seqMap.get(slicedTurns[0]) ?? 0) : 0;
      const recentActions = records
        .map((rec, seq) => ({ rec, seq }))
        .filter(
          (entry): entry is { rec: ActionRecord; seq: number } =>
            entry.seq >= Math.max(0, firstSeq - 5) && entry.rec.kind === "action",
        )
        .map(({ rec, seq }) => ({
          seq,
          at: rec.at,
          action: rec.action,
          notes: rec.notes,
          commands: rec.commands,
        }));

      const recentTurns = slicedTurns.map((t) => ({
        seq: seqMap.get(t) ?? -1,
        at: t.at,
        ooc: t.ooc ?? false,
        draft: t.draft ?? false,
        scene: t.scene ?? null,
        title: t.title ?? null,
        input: t.input,
        read: t.read ?? null,
        ruling: t.ruling ?? null,
        decided: t.decided ?? [],
        dice: t.dice ?? [],
        check: t.check ?? null,
        resolves: t.resolves ?? null,
        commands: t.commands,
        dropped: t.dropped,
        considered: t.considered ?? [],
        flags: t.flags ?? [],
        notes: t.notes ?? [],
        unsettled: t.unsettled ?? null,
        recalled: t.recalled ?? [],
        expanded: t.expanded ?? [],
        retrieval: t.retrieval ?? null,
        lore: t.lore ?? null,
        offscreenSkip: t.offscreenSkip ?? null,
        offscreen: t.offscreen ?? null,
        summary: t.summary ?? null,
        closeup: t.closeup ?? null,
        clutch: t.clutch ?? false,
        choices: t.choices ?? [],
        modules: t.modules ?? [],
        usage: t.usage ?? null,
        budget: t.budget ?? null,
        text: t.text,
        ...(includeThought && t.thought !== undefined ? { thought: t.thought } : {}),
      }));

      let lastTurnStages: StagePrompt[] | undefined;
      let lastTurnMessages: readonly LlmMessage[] | undefined;
      let promptRebuildError: string | null = null;
      const lastTurn = slicedTurns[slicedTurns.length - 1];
      if (includePrompt && lastTurn) {
        const lastSeq = seqMap.get(lastTurn);
        const parsedInput = TurnInputSchema.safeParse(lastTurn.input);
        if (lastSeq !== undefined && parsedInput.success) {
          try {
            if (lastTurn.replaces !== undefined) {
              const previous = records[lastTurn.replaces];
              if (previous?.kind !== "turn") throw new Error("改写前的回合记录不存在");
              const messages = buildRewritePrompt(previous);
              lastTurnStages = [
                {
                  stage: "narrate",
                  label: "③ 按账目改写",
                  messages,
                  modules: [],
                  chars: messages.reduce((n, message) => n + message.content.length, 0),
                },
              ];
              lastTurnMessages = messages;
            } else {
              const before = records.slice(0, lastSeq);
              const beforeWorld = await this.worldAt(id, meta, before);
              const plan: NarratorPlan = { kind: "action", input: parsedInput.data };
              const extras = {
                data: runtime.data,
                startTime: meta.startTime,
                opening: openingPremise(
                  meta.opening,
                  meta.startLocation,
                  openingContextOf(beforeWorld, meta.startTime),
                ),
              };
              const stage = (
                stageId: StagePrompt["stage"],
                label: string,
                built: { messages: readonly LlmMessage[]; modules: readonly string[] },
              ): StagePrompt => ({
                stage: stageId,
                label,
                messages: [...built.messages],
                modules: [...built.modules],
                chars: built.messages.reduce((n, m) => n + m.content.length, 0),
              });
              const stages: StagePrompt[] = [];
              if (parsedInput.data.mode !== "ooc") {
                const lately = effectiveTurns(before)
                  .slice(-2)
                  .map((t) => t.text)
                  .join("\n");
                const pool = memoryPool(
                  beforeWorld,
                  before,
                  lastTurn.budget?.history ?? HISTORY_TURNS,
                  lastTurn.budget?.recapTokens,
                );
                const memories = judgeCandidates(pool, beforeWorld, {
                  input: parsedInput.data.text,
                  context: lately,
                });
                stages.push(
                  stage(
                    "judge",
                    "① 判断",
                    buildJudgePrompt(beforeWorld, before, plan, extras, memories),
                  ),
                );
              }
              const boosted = lastTurn.commands.some(
                (c) =>
                  typeof c === "object" &&
                  c !== null &&
                  (c as { type?: unknown }).type === "cyberware.boost",
              );
              const livePlan: NarratorPlan =
                boosted && plan.input.sandevistan !== true
                  ? { ...plan, input: { ...plan.input, sandevistan: true } }
                  : plan;
              const narrateStage = stage(
                "narrate",
                "③ 写正文",
                buildNarratorPrompt(beforeWorld, before, livePlan, {
                  ...extras,
                  decided: lastTurn.decided,
                  recalled: [...(lastTurn.recalled ?? []), ...(lastTurn.expanded ?? [])],
                  lore: lastTurn.lore?.section,
                  history: lastTurn.budget?.history,
                  recapTokens: lastTurn.budget?.recapTokens,
                }),
              );
              stages.push(narrateStage);
              if (lastTurn.ooc !== true) {
                stages.push(
                  stage(
                    "extract",
                    "④ 抽取",
                    buildExtractPrompt(
                      beforeWorld,
                      before,
                      livePlan,
                      { ...extras, decided: lastTurn.decided },
                      lastTurn.text,
                    ),
                  ),
                );
              }
              if (lastTurn.offscreen) {
                stages.push(
                  stage("offscreen", "⑥ 场外推演", {
                    messages: [
                      { role: "system", content: OFFSCREEN_SYSTEM },
                      { role: "user", content: lastTurn.offscreen.prompt },
                      { role: "assistant", content: lastTurn.offscreen.reply },
                    ],
                    modules: [],
                  }),
                );
              }
              if (lastTurn.summary) {
                stages.push(
                  stage("summary", "⑦ 场景摘要", {
                    messages: [
                      { role: "system", content: SUMMARY_SYSTEM },
                      { role: "user", content: lastTurn.summary.prompt },
                      { role: "assistant", content: lastTurn.summary.reply },
                    ],
                    modules: [],
                  }),
                );
              }
              lastTurnStages = stages;
              lastTurnMessages = narrateStage.messages;
            }
          } catch (error) {
            promptRebuildError = error instanceof Error ? error.message : String(error);
          }
        }
      }

      const hereDest = view.travel.destinations.find((d) => d.here);
      const activeQuotes = commerce.success
        ? Object.values(commerce.data.quotes).filter((q) => q.status === "offered")
        : [];
      const activeSessions = commerce.success
        ? Object.values(commerce.data.sessions).filter((s) =>
            ["active", "paused"].includes(s.status),
          )
        : [];
      const eddies =
        typeof (world.slices.economy as { eddies?: unknown } | undefined)?.eddies === "number"
          ? (world.slices.economy as { eddies: number }).eddies
          : 0;
      let edgeLedger: unknown = null;
      try {
        edgeLedger = extractEdgeLedgerState(world, runtime.data);
      } catch {
        edgeLedger = null;
      }

      return {
        meta: {
          id,
          title: meta.title,
          characterId: meta.characterId,
          createdAt: meta.createdAt,
          startTime: meta.startTime,
          opening: meta.opening ?? null,
          startLocation: meta.startLocation ?? null,
          characterName: view.character.name ?? null,
          loadouts: meta.loadouts ?? [],
          workshopPacks: (meta.workshopPacks ?? []).map((pack) => ({
            id: pack.id,
            title: pack.title,
            version: pack.version,
          })),
        },
        snapshot: {
          version: logVersion(records),
          totalTurns: view.totalTurns,
          totalRecords: records.length,
          actionCount,
          voidedCount,
          locationId: clock.success ? clock.data.location : null,
          locationName: hereDest?.name ?? null,
          gameTime: view.time.text,
          worldTimeMinutes: world.time,
          eddies,
          death: view.death !== null,
          ended: view.ended !== null,
          sliceKeys: Object.keys(world.slices).sort(),
        },
        edgeLedger,
        checkpoint,
        commerce: {
          activeQuotes,
          activeSessions,
          registeredParties: commerce.success ? Object.values(commerce.data.parties) : [],
        },
        ...(includeWorldState
          ? {
              worldState: {
                time: world.time,
                slices: world.slices,
              },
              characterMeta: meta.character ?? null,
              boardStart: meta.board ?? null,
            }
          : {}),
        recentActions,
        recentTurns,
        ...(lastTurnStages ? { lastTurnStages } : {}),
        ...(lastTurnMessages ? { lastTurnMessages } : {}),
        ...(promptRebuildError ? { promptRebuildError } : {}),
      };
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
    data: Readonly<Record<string, unknown>>,
    plan: NarratorPlan,
    opening: string | undefined,
    startTime: number,
    offscreen: OffscreenPace | undefined,
    encounters?: travelRules.EncounterPace,
    startLocation?: string | undefined,
    checkpoint?: TurnCheckpoint | undefined,
  ): Promise<void> {
    const { hub } = this.deps;
    const redact = await this.deps.config.redactor();
    const signal = run.controller.signal;
    let latestCheckpoint = checkpoint;
    try {
      const resolved = await this.deps.llm.resolve("narrator");
      if (!resolved.ok) {
        hub.push(run, { type: "error", message: redact(resolved.error), retryable: false });
        return;
      }
      const aux = await this.deps.llm.resolve("aux");
      const narratorModel = resolved.profile.model;
      const auxModel = aux.ok ? aux.profile.model : narratorModel;
      const stageModel = (stage: TurnStage): string | undefined => {
        switch (stage) {
          case "narrate":
            return narratorModel;
          case "judge":
          case "extract":
          case "repair":
          case "offscreen":
          case "summary":
            return auxModel;
          case "prepare":
          case "commit":
            return undefined;
        }
      };
      const inputKey = turnInputKey(plan.input);
      const pendingSpend = this.pendingSpends.get(run.saveId);
      const approvedSpend =
        plan.input.spendOk &&
        pendingSpend?.version === run.baseVersion &&
        pendingSpend.input === inputKey
          ? pendingSpend.quoteKey
          : plan.input.spendOk
            ? checkpoint?.prepared.confirmation?.quoteKey
            : undefined;
      const [embedder, reranker] = await Promise.all([
        this.deps.llm.resolveEmbedder((msg) => this.deps.log(msg), {
          saveId: run.saveId,
          cache: this.deps.embeddingCache,
        }),
        this.deps.llm.resolveReranker((msg) => this.deps.log(msg)),
      ]);
      const [preset, worldbooks] = await Promise.all([
        this.deps.presets?.active(),
        this.deps.worldbooks?.active(),
      ]);
      if (signal.aborted) throw new NarratorAbortedError("已停止");
      const result = await runNarratorTurn(
        {
          llm: this.deps.llm,
          embedder,
          reranker,
          contextWindow: resolved.profile.contextWindow,
          maxOutputTokens: resolved.profile.maxOutputTokens,
          auxContextWindow: aux.ok ? aux.profile.contextWindow : undefined,
          auxMaxOutputTokens: aux.ok ? aux.profile.maxOutputTokens : undefined,
          approvedSpend,
          rng: this.deps.rng,
          data,
          opening: openingPremise(opening, startLocation, openingContextOf(world, startTime)),
          startTime,
          offscreen: OFFSCREEN_PACE_SCENES[offscreen ?? "normal"],
          encounters: travelRules.ENCOUNTER_PACE_FACTORS[encounters ?? "normal"],
          // 本轮开始前读取一次预设与世界书；生成途中切换开关，不改变这一轮已经选定的内容。
          preset,
          worldbooks,
          signal,
          saveId: run.saveId,
          baseVersion: run.baseVersion,
          checkpoint,
          onCheckpoint: async (cp) => {
            if (signal.aborted) throw new NarratorAbortedError("已停止");
            latestCheckpoint = cp;
            await this.deps.checkpoints?.save(run.saveId, cp);
          },
          onText: (text) => hub.push(run, { type: "text", text }),
          onThought: (text) => hub.push(run, { type: "thought", text }),
          onStage: (info) => {
            const model = stageModel(info.stage);
            hub.push(run, { type: "stage", ...info, ...(model ? { model } : {}) });
          },
          onBoost: (boost) => hub.push(run, { type: "boost", ...boost }),
        },
        world,
        records,
        plan,
      );
      if (signal.aborted) throw new NarratorAbortedError("已停止");
      if (result.kind === "blocked") {
        hub.push(run, { type: "blocked", reason: redact(result.reason) });
        return;
      }
      if (result.kind === "confirmSpend") {
        const { label, price, eddies } = result;
        this.pendingSpends.set(run.saveId, {
          version: run.baseVersion,
          input: inputKey,
          quoteKey: result.quoteKey,
        });
        hub.push(run, { type: "confirmSpend", label, price, eddies });
        return;
      }
      const { turn } = result;
      const usage = addUsage(addUsage(turn.usage, turn.auxUsage), turn.repairUsage);
      hub.push(run, {
        type: "stage",
        stage: "commit",
        label: "⑤ 写入回合日志",
        detail: "保存世界状态与快照",
      });
      const saved = await this.commit(run, plan, turn, usage, world, data);
      this.pendingSpends.delete(run.saveId);
      if (turn.repairs > 0) {
        this.deps.log(`存档 ${run.saveId} 第 ${saved.seq} 轮修了 ${turn.repairs} 次指令格式`);
      }
      hub.push(run, { type: "done", ...saved, ...(usage ? { usage } : {}) });
      if (embedder && !turn.draft && !turn.ooc) {
        void this.prewarmEmbeddings(run.saveId, embedder, turn.world, records);
      }
    } catch (error) {
      const savedHint = latestCheckpoint
        ? "（已完成的前置步骤已保存，点重试可直接从断点继续）"
        : "";
      if (
        error instanceof NarratorAbortedError ||
        error instanceof AbortedError ||
        signal.aborted
      ) {
        hub.push(run, { type: "stopped" });
      } else if (error instanceof NarratorStageError) {
        hub.push(run, {
          type: "error",
          message: redact(error.message),
          retryable: error.retryable,
        });
      } else if (error instanceof NarratorEmptyReplyError) {
        hub.push(run, {
          type: "error",
          message: `模型没有返回正文，可以重试${savedHint}`,
          retryable: true,
        });
      } else if (error instanceof UpstreamError) {
        hub.push(run, {
          type: "error",
          message: `${redact(error.message)}${savedHint}`,
          retryable: error.retryable,
        });
      } else if (error instanceof VersionMovedError || error instanceof SaveMovedError) {
        // 写回前核对没通过：什么都没写，不自动重试，原因直接告诉玩家
        hub.push(run, { type: "error", message: error.message, retryable: false });
      } else {
        this.deps.log(
          `回合出错：${redact(error instanceof Error ? (error.stack ?? error.message) : String(error))}`,
        );
        hub.push(run, {
          type: "error",
          message: `生成时出错，详情见后端日志${savedHint}`,
          retryable: latestCheckpoint !== undefined,
        });
      }
    }
  }

  private commit(
    run: TurnRun,
    plan: NarratorPlan,
    turn: NarratorTurn,
    usage: TurnUsage | undefined,
    before: WorldState,
    data: Readonly<Record<string, unknown>>,
  ): Promise<{ seq: number; version: number }> {
    const { saves } = this.deps;
    return this.locks.run(run.saveId, async () => {
      // 写回前核对（第 4 项）：等锁期间玩家可能点了停止，或者这一轮已经结束、被新的一轮顶掉
      if (run.controller.signal.aborted) throw new NarratorAbortedError("已停止");
      if (run.finishedAt !== null || this.deps.hub.running(run.saveId) !== run) {
        throw new VersionMovedError("这一轮已经结束或被新的一轮顶掉，没有保存");
      }
      // 记录条数的核对和追加由 appendAt 一起做，条数不对时抛 SaveMovedError、什么都不写
      const seq = run.baseVersion;
      const media = turn.draft
        ? []
        : collectPresentedContentMedia(before, turn.world, turn.commands, data);
      let imageContext: ReturnType<typeof buildImageSceneContext> | undefined;
      try {
        imageContext = buildImageSceneContext(turn.world, [], data, turn.text);
      } catch (error) {
        this.deps.log(
          `存档 ${run.saveId} 第 ${seq} 轮的配图场景记录失败，配图将仅依据正文：${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const record: TurnRecord = {
        kind: "turn",
        seq,
        at: this.deps.clock.now().toISOString(),
        requestId: run.requestId,
        baseVersion: run.baseVersion,
        input: plan.input,
        commands: [...turn.commands],
        dropped: [...turn.dropped],
        text: turn.text,
        ...(turn.thought ? { thought: turn.thought } : {}),
        ...(media.length ? { media } : {}),
        ...(imageContext ? { imageContext } : {}),
        patches: [...turn.patches],
        ...(turn.read !== undefined ? { read: turn.read } : {}),
        ...(turn.choices.length > 0 ? { choices: [...turn.choices] } : {}),
        ...(turn.clutch ? { clutch: true } : {}),
        scene: turn.scene,
        ...(turn.title !== undefined ? { title: turn.title } : {}),
        ...(turn.closeup !== undefined ? { closeup: turn.closeup } : {}),
        ...(turn.ooc ? { ooc: true } : {}),
        ...(turn.notes.length > 0 ? { notes: [...turn.notes] } : {}),
        ...(turn.unsettled !== undefined ? { unsettled: turn.unsettled } : {}),
        ...(turn.draft ? { draft: true as const } : {}),
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
      run.committing = true;
      await saves.appendAt(run.saveId, seq, serializeRecord(record));
      await this.clearCheckpointBestEffort(run.saveId);
      const version = seq + 1;
      await this.maybeSnapshot(run.saveId, version);
      return { seq, version };
    });
  }

  /** 断点只是续跑缓存：落盘成功后清断点失败不能把已保存的操作误报为失败。 */
  private async clearCheckpointBestEffort(id: string): Promise<void> {
    try {
      await this.deps.checkpoints?.clear(id);
    } catch (error) {
      this.deps.log(
        `存档 ${id} 的记录已保存，但清理旧断点失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** 快照只是缓存：失败不能把已经落盘的操作误报为失败。调用方持有这个存档的锁。 */
  private async maybeSnapshot(id: string, version: number): Promise<void> {
    if (version % SNAPSHOT_EVERY !== 0) return;
    try {
      // 另一页可能在日志落盘后又提交了一步，快照版本必须与实际重建的状态一致。
      const { world, records } = await this.load(id);
      await this.deps.saves.writeSnapshot(id, { nextSeq: logVersion(records), world });
    } catch (error) {
      this.deps.log(
        `存档 ${id} 的回合已保存，但自动快照创建失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** 选一个位于指定记录区间及之前（且不晚于 maxSeq）的最新有效快照；没有时退回初始世界 */
  private async snapshotFor(
    id: string,
    meta: SaveMeta,
    records: readonly LogRecord[],
    maxSeq?: number,
  ): Promise<Snapshot> {
    const runtime = this.runtime(meta);
    const all = await this.deps.saves.readSnapshots(id);
    const eligible = maxSeq === undefined ? all : all.filter((s) => s.nextSeq <= maxSeq);
    const snapshot = pickSnapshot(eligible, records) ?? {
      nextSeq: 0,
      world: newGameWorld(meta, runtime.content),
    };
    return { ...snapshot, world: withAllSlices(snapshot.world) };
  }

  /** 从适用于这段日志的快照重建世界；调用方持有这个存档的锁 */
  private async worldAt(
    id: string,
    meta: SaveMeta,
    records: readonly LogRecord[],
  ): Promise<WorldState> {
    return replay(await this.snapshotFor(id, meta, records), records);
  }

  /** 回合落盘后的后台异步向量预热：不持存档锁，新一轮提交时立即中止，提前缓存新增记忆文档向量 */
  private async prewarmEmbeddings(
    saveId: string,
    embedder: Embedder,
    world: WorldState,
    records: readonly LogRecord[],
  ): Promise<void> {
    this.cancelPrewarm(saveId);
    const controller = new AbortController();
    this.prewarmControllers.set(saveId, controller);
    try {
      const pool = memoryPool(world, records, HISTORY_TURNS);
      if (pool.length === 0 || controller.signal.aborted) return;
      const docTexts = pool.map((e) => `${e.title}\n${e.text}`.slice(0, 600));
      await embedder.embed(docTexts, { task: "document", signal: controller.signal });
    } catch {
      // 后台预热完全尽力而为，取消或失败静默忽略，不影响玩家体验
    } finally {
      if (this.prewarmControllers.get(saveId) === controller) {
        this.prewarmControllers.delete(saveId);
      }
    }
  }

  /** 调用方持有这个存档的锁 */
  private async load(id: string): Promise<Loaded> {
    const { saves } = this.deps;
    const meta = await saves.readMeta(id);
    const runtime = this.runtime(meta);
    const log = await saves.loadLog(id);
    if (log.droppedPartialTail) this.deps.log(`存档 ${id} 的回合日志末尾有半行，已经截掉`);
    const snapshot = pickSnapshot(await saves.readSnapshots(id), log.records) ?? {
      nextSeq: 0,
      world: newGameWorld(meta, runtime.content),
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
/** 手机私信直聊最多等这么久 */
const PHONE_CHAT_TIMEOUT_MS = 45_000;

export const RegenerateRequestSchema = z.object({ baseVersion: z.number().int().min(0) });

/** 删楼 / 撤销到指定回合之前：fromSeq 缺省时删除最后一楼 */
export const UndoTurnRequestSchema = z.object({
  baseVersion: z.number().int().min(0),
  fromSeq: z.number().int().min(0).optional(),
});

/** 角色死了、或玩家给故事收了尾，就不能再提交回合和操作 */
function deathBlock(
  world: WorldState,
  records: readonly LogRecord[],
  version: number,
  data: Readonly<Record<string, unknown>>,
): Reply | undefined {
  const { death, ended } = projectState(world, records, data);
  if (ended && !death) {
    return {
      status: 409,
      body: { error: "这个角色的故事已经结束，只能回看", ended, version },
    };
  }
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
