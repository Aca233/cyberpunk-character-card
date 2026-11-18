import {
  DEFAULT_LOADOUT,
  DEFAULT_OPENING,
  gameContent,
  gameData,
  type OpeningContext,
  openingPremise,
  RADAR_ANCHORS,
} from "@cp/content";
import {
  type ActionRecord,
  type ActionRequest,
  applyPlayerAction,
  boardStart,
  braindanceRules,
  buildExtractPrompt,
  buildJudgePrompt,
  buildLedger,
  buildNarratorPrompt,
  type Clock,
  characterRules,
  cityRules,
  effectiveTurns,
  HISTORY_TURNS,
  isSnapshotValid,
  judgeCandidates,
  type Legend,
  type LlmMessage,
  type LogRecord,
  legendNotes,
  legendOf,
  loadoutText,
  logVersion,
  memoryPool,
  NarratorAbortedError,
  NarratorEmptyReplyError,
  type NarratorPlan,
  type NarratorTurn,
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
  replay,
  rewriteNarrative,
  runNarratorTurn,
  runPhoneChat,
  type SaveMeta,
  SaveMetaSchema,
  SUMMARY_SYSTEM,
  safehouseRules,
  sandevistanBlock,
  saveCharacter,
  sceneStartSeq,
  serializeRecord,
  TurnInputSchema,
  type TurnRecord,
  type TurnRequest,
  type TurnStage,
  type TurnUsage,
  travelBlock,
  travelRules,
  type VoidRecord,
  validatePhoneChatTarget,
  voidedSeqs,
  type WorldState,
  withAllSlices,
  worldRules,
} from "@cp/core";
import { z } from "zod";
import type { CharacterStore } from "./characters";
import type { ConfigService } from "./config";
import { KeyedMutex } from "./mutex";
import { SaveMovedError, type SaveStorage } from "./ports";
import type { PresetStore } from "./presets";
import { AbortedError, UpstreamError } from "./providers/http";
import type { LlmRouter } from "./providers/index";
import { randomHex } from "./random";
import type { TurnHub, TurnRun } from "./turns";

/** 每追加这么多条记录写一次快照 */
export const SNAPSHOT_EVERY = 10;
export const DEFAULT_START = "2077-01-01 22:00";

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
}

interface Loaded {
  readonly meta: SaveMeta;
  readonly records: readonly LogRecord[];
  readonly world: WorldState;
}

/** 名册里的一位：带上存档 id 和标题，好从名册点回去回看 */
export type SavedLegend = Legend & { readonly saveId: string; readonly title: string };

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
 * 主动停止、无正文的失败或拦截不写回合；正文中断或整份抽取失败时保存零结算草稿。
 * 重试由 requestId 和版本核对防止重复写入。
 */
export class GameService {
  private readonly locks = new KeyedMutex();
  /** 确认绑定本次输入、存档版本和完整报价；重启或状态改变后需重新确认。 */
  private readonly pendingSpends = new Map<
    string,
    { version: number; input: string; quoteKey: string }
  >();

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

  /**
   * 传说名册：死了不能重来、或者玩家给故事收了尾的角色，最近的在前。
   * 每次请求按各存档现算，所以旧存档里死掉的角色也在；读不了的存档跳过
   */
  async legends(): Promise<SavedLegend[]> {
    const out: SavedLegend[] = [];
    for (const id of await this.deps.saves.list()) {
      try {
        const legend = await this.locks.run(id, async (): Promise<SavedLegend | null> => {
          const { meta, world, records } = await this.load(id);
          const view = projectState(world, records, gameData);
          const found = legendOf(view, world.time, meta.startTime);
          return found && { ...found, saveId: id, title: meta.title };
        });
        if (legend) out.push(legend);
      } catch (error) {
        this.deps.log(
          `名册跳过读不了的存档 ${id}：${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return out.sort((a, b) => b.at - a.at);
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
    const matchInput = loadoutText(entry.card);
    const cardStart = entry.card.board?.startLocation;
    const startLocation =
      input.startLocation ??
      (cardStart && RADAR_ANCHORS.some((anchor) => anchor.id === cardStart)
        ? cardStart
        : pickStartLocation(matchInput, gameContent.loadouts ?? []));
    const start = boardStart(entry.card);
    // 名册摘要在建档时冻结进 meta：之后名册再变，这份存档重放出来的提示词也不变
    const legends = legendNotes(await this.legends());
    const meta: SaveMeta = {
      ...input,
      startLocation,
      createdAt: this.deps.clock.now().toISOString(),
      character: saveCharacter(entry.card),
      opening: DEFAULT_OPENING,
      loadouts: pickLoadouts(matchInput, gameContent.loadouts ?? [], DEFAULT_LOADOUT),
      ...(start ? { board: start } : {}),
      ...(legends.length > 0 ? { legends } : {}),
    };
    try {
      newGameWorld(meta, gameContent);
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
      const { meta, world, records } = await this.load(id);
      // 最后一条记录之前的世界：系统通知比的是这一步前后的变化
      const before =
        records.length > 0 ? await this.worldAt(id, meta, records.slice(0, -1)) : undefined;
      return projectState(world, records, gameData, before);
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
      if (request.input.braindance !== undefined) {
        const blocked = braindanceRules.concludeBlock(
          world.slices.braindance,
          request.input.braindance,
        );
        if (blocked) return { status: 409, body: { error: blocked, version } };
      }
      const unavailable = await this.llmUnavailable();
      if (unavailable) return unavailable;
      const run = hub.start(id, request.requestId, version, request.input);
      void this.execute(
        run,
        world,
        records,
        { kind: "action", input: request.input },
        meta.opening,
        meta.startTime,
        request.offscreen,
        request.encounters,
        meta.startLocation,
      );
      return { status: 202, body: { turnId: run.turnId, replayed: false } };
    });
  }

  /** 界面操作（装备、交易、读消息等）：不调用模型，结算后写一条 action 记录 */
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
      if (request.baseVersion !== version) {
        return { status: 409, body: { error: "存档已经更新过，请刷新后再操作", version } };
      }
      const result = applyPlayerAction(world, request.action, {
        rng: this.deps.rng,
        data: gameData,
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
      await this.maybeSnapshot(id, version + 1);
      return { status: 200, body: { seq: version, version: version + 1, notes: result.notes } };
    });
  }

  /** 手机窗口内轻量直聊：仅调辅助模型与双人窄上下文，推进 1–3 分钟游戏时钟并记入 action 日志 */
  async phoneChat(id: string, request: PhoneChatRequest): Promise<Reply> {
    const checked = await this.locks.run(
      id,
      async (): Promise<{ reply: Reply } | { world: WorldState; version: number }> => {
        const { world, records } = await this.load(id);
        const version = logVersion(records);
        const done = records.find((r) => r.kind === "action" && r.requestId === request.requestId);
        if (done) {
          return { reply: { status: 200, body: { duplicate: true, seq: done.seq, version } } };
        }
        const dead = deathBlock(world, records, version);
        if (dead) return { reply: dead };
        const refuse = (error: string): { reply: Reply } => ({
          reply: { status: 409, body: { error, version } },
        });
        if (this.deps.hub.running(id)) return refuse("这一轮还在生成，等它结束再发消息");
        if (request.baseVersion !== version) return refuse("存档已经更新过，请刷新后再发");
        const target = validatePhoneChatTarget(world, request.contact);
        if (!target.ok) return refuse(target.reason);
        return { world, version };
      },
    );
    if ("reply" in checked) return checked.reply;
    const { world, version } = checked;

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
          data: gameData,
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
            error: "这个场景已经重来过一次，这一次是真的死了",
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
      return { status: 200, body: { version: version + targets.length, voided: targets.length } };
    });
  }

  /**
   * 重新生成最后一轮：把它作废（reason regenerate），返回当时的玩家输入，
   * 网页再按输入提交流程重发。
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
      let last = records.findLast((r) => r.kind !== "void" && !voided.has(r.seq));
      if (last?.kind !== "turn") {
        const latestTurn = effectiveTurns(records).at(-1);
        // 零结算草稿没有改变世界，撤掉它不会影响此后的读消息、装备或习惯等操作。
        // 已结算回合仍要求位于最后一步，避免其后的操作依赖被撤掉的状态。
        if (latestTurn?.draft === true && latestTurn.patches.length === 0) last = latestTurn;
      }
      if (last?.kind !== "turn") {
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
      try {
        await this.deps.saves.appendAt(id, version, serializeRecord(record));
      } catch (error) {
        if (!(error instanceof SaveMovedError)) throw error;
        return { status: 409, body: { error: error.message, version: error.actual } };
      }
      const pending = { kind: "input", input: input.data };
      return { status: 200, body: { version: version + 1, voided: last.seq, pending } };
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
        const plan: NarratorPlan = { kind: "action", input: input.data };
        const extras = {
          data: gameData,
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
              (record.ooc ? "场外提问，不推演" : "尚未触发需要推演的世界变化")),
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
   * 连同当时的回复构建成用例草稿 JSON 返回给网页下载；补上期望后可放进 tools/evals/ 进测评
   */
  evalDraft(id: string, seq: number): Promise<Reply> {
    return this.locks.run(id, async (): Promise<Reply> => {
      const meta = await this.deps.saves.readMeta(id);
      const { records } = await this.deps.saves.loadLog(id);
      const record = records[seq];
      if (record?.kind !== "turn" || !effectiveTurns(records).includes(record)) {
        return { status: 404, body: { error: `没有第 ${seq} 轮` } };
      }
      const input = TurnInputSchema.safeParse(record.input);
      if (!input.success) return { status: 400, body: { error: "这一轮的玩家输入格式不对" } };
      const before = records.slice(0, seq);
      const ask = { input: input.data };
      const world = replay({ nextSeq: 0, world: newGameWorld(meta, gameContent) }, before);
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
    startLocation?: string | undefined,
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
      const { spendOk: _spendOk, ...spendInput } = plan.input;
      const inputKey = JSON.stringify(spendInput);
      const pendingSpend = this.pendingSpends.get(run.saveId);
      const approvedSpend =
        plan.input.spendOk &&
        pendingSpend?.version === run.baseVersion &&
        pendingSpend.input === inputKey
          ? pendingSpend.quoteKey
          : undefined;
      const result = await runNarratorTurn(
        {
          llm: this.deps.llm,
          contextWindow: resolved.profile.contextWindow,
          maxOutputTokens: resolved.profile.maxOutputTokens,
          auxContextWindow: aux.ok ? aux.profile.contextWindow : undefined,
          auxMaxOutputTokens: aux.ok ? aux.profile.maxOutputTokens : undefined,
          approvedSpend,
          rng: this.deps.rng,
          data: gameData,
          opening: openingPremise(opening, startLocation, openingContextOf(world, startTime)),
          startTime,
          offscreen: OFFSCREEN_PACE_SCENES[offscreen ?? "normal"],
          encounters: travelRules.ENCOUNTER_PACE_FACTORS[encounters ?? "normal"],
          // 本轮开始前读取一次预设；生成途中切换开关，不改变这一轮已经选定的内容。
          preset: await this.deps.presets?.active(),
          signal,
          onText: (text) => hub.push(run, { type: "text", text }),
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
      if (signal.aborted) throw new NarratorAbortedError("已停止");
      const { turn } = result;
      const usage = addUsage(addUsage(turn.usage, turn.auxUsage), turn.repairUsage);
      hub.push(run, {
        type: "stage",
        stage: "commit",
        label: "⑤ 写入回合日志",
        detail: "保存世界状态与快照",
      });
      const saved = await this.commit(run, plan, turn, usage);
      this.pendingSpends.delete(run.saveId);
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
      } else if (error instanceof VersionMovedError || error instanceof SaveMovedError) {
        // 写回前核对没通过：什么都没写，不自动重试，原因直接告诉玩家
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
      // 写回前核对（第 4 项）：等锁期间玩家可能点了停止，或者这一轮已经结束、被新的一轮顶掉
      if (run.controller.signal.aborted) throw new NarratorAbortedError("已停止");
      if (run.finishedAt !== null || this.deps.hub.running(run.saveId) !== run) {
        throw new VersionMovedError("这一轮已经结束或被新的一轮顶掉，没有保存");
      }
      // 记录条数的核对和追加由 appendAt 一起做，条数不对时抛 SaveMovedError、什么都不写
      const seq = run.baseVersion;
      const record: TurnRecord = {
        kind: "turn",
        seq,
        at: this.deps.clock.now().toISOString(),
        requestId: run.requestId,
        baseVersion: run.baseVersion,
        input: plan.input,
        dice: [],
        commands: [...turn.commands],
        dropped: [...turn.dropped],
        text: turn.text,
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
      await saves.appendAt(run.saveId, seq, serializeRecord(record));
      const version = seq + 1;
      await this.maybeSnapshot(run.saveId, version);
      return { seq, version };
    });
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

  /** 从适用于这段日志的快照重建世界；调用方持有这个存档的锁 */
  private async worldAt(
    id: string,
    meta: SaveMeta,
    records: readonly LogRecord[],
  ): Promise<WorldState> {
    const snapshot = pickSnapshot(await this.deps.saves.readSnapshots(id), records) ?? {
      nextSeq: 0,
      world: newGameWorld(meta, gameContent),
    };
    return replay({ ...snapshot, world: withAllSlices(snapshot.world) }, records);
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
/** 手机私信直聊最多等这么久 */
const PHONE_CHAT_TIMEOUT_MS = 45_000;

export const RegenerateRequestSchema = z.object({ baseVersion: z.number().int().min(0) });

/** 角色死了、或玩家给故事收了尾，就不能再提交回合和操作 */
function deathBlock(
  world: WorldState,
  records: readonly LogRecord[],
  version: number,
): Reply | undefined {
  const { death, ended } = projectState(world, records, gameData);
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
