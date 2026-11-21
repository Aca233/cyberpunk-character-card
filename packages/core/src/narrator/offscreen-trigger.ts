import type { LlmMessage } from "../kernel/ports";
import type { Command } from "../kernel/system";
import { effectiveTurns, type LogRecord } from "../kernel/turnlog";
import type { WorldState } from "../kernel/world";
import { TurnInputSchema } from "../schemas/turn";
import {
  CityStateSchema,
  OFFSCREEN_HOURS,
  OFFSCREEN_RETRY_TURNS,
  OFFSCREEN_SCENES,
  OFFSCREEN_STALE_MINUTES,
  OFFSCREEN_STALE_TURNS,
  type OffscreenCursor,
  type OffscreenTrack,
} from "../systems/city";
import { JobsStateSchema } from "../systems/jobs";
import { memoryRecords } from "../systems/memory";
import { NpcStateSchema } from "../systems/npc";
import { ThreadsStateSchema } from "../systems/threads";
import { WorldClockStateSchema } from "../systems/world";
import { estimateTokens } from "./prompts/layers";

export interface OffscreenCapacity {
  readonly contextWindow: number;
  readonly maxOutputTokens?: number;
}

export interface OffscreenPromptScope {
  /** 本批实际包含的历史正文终点；未处理的后续轮次不混入本批因果。 */
  readonly through: number;
  /** 仍有后续待处理正文；当前轮仅作防止旧事实覆盖现状的保护上下文。 */
  readonly backlog: boolean;
}

export type OffscreenBatch =
  | {
      readonly kind: "ready";
      readonly messages: LlmMessage[];
      readonly through: number;
      readonly backlog: boolean;
      readonly inputTokens: number;
      readonly inputLimit: number;
      readonly maxOutputTokens: number;
    }
  | {
      readonly kind: "blocked";
      readonly reason: string;
      readonly inputTokens: number;
      readonly inputLimit: number;
      readonly maxOutputTokens: number;
    };

/** 刚收的这一场里出场过、还在原地的人：他就在玩家眼前，近况由正文写 */
export function presentNpcs(before: WorldState, after: WorldState): Set<string> {
  const clock = WorldClockStateSchema.parse(after.slices.world);
  const npcs = NpcStateSchema.parse(after.slices.npc).npcs;
  return new Set(
    Object.values(npcs)
      .filter(
        (n) =>
          n.location !== null &&
          n.location === clock.location &&
          n.lastSeenAt !== null &&
          n.lastSeenAt >= Math.min(clock.sceneStartedAt, before.time),
      )
      .map((n) => n.id),
  );
}

/** 只带尚未成功处理的有效正文；本批因果不因场次、同分钟或固定字数而丢失。 */
export function pendingTurns(world: WorldState, records: readonly LogRecord[], through: number) {
  return effectiveTurns(memoryRecords(world, records)).filter((r) => {
    if (r.seq <= through || r.ooc || r.unsettled) return false;
    const input = TurnInputSchema.safeParse(r.input);
    return !input.success || input.data.mode !== "ooc";
  });
}

/** 当前即将提交的回合序号 */
export function currentTurnSeq(records: readonly LogRecord[]): number {
  return records.reduce((next, record) => Math.max(next, record.seq + 1), 0);
}

/** 计算某通道失败后的保底重试回合号 */
export function nextRetrySeq(records: readonly LogRecord[]): number {
  return currentTurnSeq(records) + OFFSCREEN_RETRY_TURNS;
}

/** 检测本轮是否出现了足以立刻激起城中余波的高烈度事件 */
export function hasMajorFallout(accepted: readonly Command[]): boolean {
  return accepted.some(
    (c) =>
      c.type === "jobEnd" ||
      c.type === "npcDeath" ||
      (c.type === "nemesis" && c.action === "rise") ||
      (c.type === "combat" && c.action === "end"),
  );
}

function cursorOf(world: WorldState, track: OffscreenTrack): OffscreenCursor {
  const city = CityStateSchema.parse(world.slices.city ?? {});
  return city[track];
}

export interface TrackDueOptions {
  readonly track: OffscreenTrack;
  readonly every?: number;
  readonly records?: readonly LogRecord[];
  readonly accepted?: readonly Command[];
}

/**
 * 单通道四维触发判断：
 * 1) 退避期到期（游戏时间到达 retryAt，或有效回合推进满保底轮数）
 * 2) 历史积压续跑（backlog）
 * 3) 场景节拍（收场且间隔 >= every）与同场景长对话防冻结（>=8 轮且 >=2 小时）
 * 4) 节点到期（threads/jobs/deadlines）、大事件余波即时触发、或距上次推演 >= 12 小时（以开局 startedAt 为首次基准）
 */
export function trackOffscreenDue(
  before: WorldState,
  after: WorldState,
  opts: TrackDueOptions,
): boolean {
  const every = opts.every ?? OFFSCREEN_SCENES;
  const was = WorldClockStateSchema.parse(before.slices.world);
  const now = WorldClockStateSchema.parse(after.slices.world);
  const cursor = cursorOf(after, opts.track);
  const seq = opts.records ? currentTurnSeq(opts.records) : null;

  if (cursor.retryAt !== null) {
    const timeReady = after.time >= cursor.retryAt;
    const turnReady = cursor.retrySeq !== null && seq !== null && seq >= cursor.retrySeq;
    return timeReady || turnReady;
  }
  if (cursor.backlog) return true;
  if (now.scene !== was.scene && now.scene - (cursor.lastScene ?? 0) >= every) return true;

  // 宏观通道检查统一局势到期与玩家插手
  if (opts.track === "macro") {
    const threads = ThreadsStateSchema.parse(after.slices.threads ?? {}).threads;
    const priorThreads = new Map(
      ThreadsStateSchema.parse(before.slices.threads ?? {}).threads.map((t) => [t.id, t]),
    );
    if (
      threads.some((t) => {
        if (t.dueAt > after.time) return false;
        if (cursor.lastAt === null || t.dueAt > cursor.lastAt) return true;
        const previous = priorThreads.get(t.id);
        if (previous?.dueAt !== t.dueAt) return true;
        const step = t.steps.at(-1);
        const priorStep = previous.steps.at(-1);
        return (
          step?.kind === "push" &&
          (priorStep?.kind !== "push" || priorStep.at !== step.at || priorStep.text !== step.text)
        );
      })
    )
      return true;
  }

  // 委托到期与期限到期触发两个通道感知余波
  const jobs = JobsStateSchema.parse(after.slices.jobs).jobs;
  if (
    jobs.some(
      (job) =>
        job.due !== null &&
        job.due <= after.time &&
        (job.status === "active" || job.status === "expired") &&
        (cursor.lastAt === null || job.due > cursor.lastAt),
    )
  )
    return true;

  if (
    now.deadlines.some(
      (deadline) =>
        deadline.handledAt === null &&
        deadline.due <= after.time &&
        (cursor.lastAt === null || deadline.due > cursor.lastAt),
    )
  )
    return true;

  // 高烈度余波：本轮结算了委托收场、战斗结束、人物死亡或新宿敌，且收场或时间推进 >= 30 分钟
  if (
    opts.accepted &&
    hasMajorFallout(opts.accepted) &&
    (now.scene !== was.scene || after.time - before.time >= 30)
  ) {
    return true;
  }

  // 首次推演前以开局 startedAt 为准，不再因收场刷新 sceneStartedAt 而重置 12 小时保底
  const since = cursor.lastAt ?? was.startedAt ?? was.sceneStartedAt;
  if (after.time - since >= OFFSCREEN_HOURS * 60) return true;

  // 同场景长对话防冻结：同一场景累计 >= 8 轮有效行动且已过 >= 2 游戏小时
  if (opts.records) {
    const pendingCount = pendingTurns(after, opts.records, cursor.processedThrough).length + 1;
    if (pendingCount >= OFFSCREEN_STALE_TURNS && after.time - since >= OFFSCREEN_STALE_MINUTES) {
      return true;
    }
  }

  return false;
}

/** 任一通道到点即触发场外演化 */
export function offscreenDue(
  before: WorldState,
  after: WorldState,
  every: number = OFFSCREEN_SCENES,
  opts?: { readonly records?: readonly LogRecord[]; readonly accepted?: readonly Command[] },
): boolean {
  return (
    trackOffscreenDue(before, after, { track: "macro", every, ...opts }) ||
    trackOffscreenDue(before, after, { track: "social", every, ...opts })
  );
}

/** ⑥ 没推演时给剧透视图的原因；没收场且未处于退避期返回 undefined，不记 */
export function offscreenSkipReason(o: {
  readonly closed: boolean;
  readonly flashback: boolean;
  readonly unsettled: boolean;
  readonly dead: boolean;
  readonly every: number | null;
  readonly retrying?: boolean;
}): string | undefined {
  if (!o.closed && !o.retrying) return undefined;
  if (o.dead) return "玩家角色死了，不推演";
  if (o.flashback) return "闪回里不推演";
  if (o.unsettled) return "这一轮没结算干净，不推演";
  if (o.every === null) return "设置里关了城里的动静";
  if (o.retrying) return "上次场外推演失败，等待重试间隔或后续回合再推";
  return `离上次推演还不到 ${o.every} 场，游戏时间也没过半天`;
}

/** 完整轮次从旧到新装入辅助模型窗口；不截断正文、不跳过放不下的因果。 */
export function fitOffscreenBatch(
  world: WorldState,
  records: readonly LogRecord[],
  track: OffscreenTrack,
  capacity: OffscreenCapacity,
  buildMessages: (scope: OffscreenPromptScope) => LlmMessage[],
): OffscreenBatch {
  const window = Math.max(1, Math.floor(capacity.contextWindow));
  const maxOutputTokens = Math.max(
    1,
    Math.floor(capacity.maxOutputTokens ?? Math.min(4096, window / 4)),
  );
  const inputLimit = Math.max(
    0,
    window - maxOutputTokens - Math.max(512, Math.ceil(window * 0.05)),
  );
  const label = track === "macro" ? "宏观局势推演" : "人物社交推演";
  const cursor = cursorOf(world, track);
  const seq = currentTurnSeq(records);
  const pending = pendingTurns(world, records, cursor.processedThrough);
  const build = (through: number, backlog: boolean) => {
    const messages = buildMessages({ through, backlog });
    return {
      messages,
      inputTokens: messages.reduce((sum, message) => sum + estimateTokens(message.content), 0),
    };
  };
  const complete = build(seq, false);
  if (complete.inputTokens <= inputLimit) {
    return {
      kind: "ready",
      ...complete,
      through: seq,
      backlog: false,
      inputLimit,
      maxOutputTokens,
    };
  }
  if (pending.length === 0) {
    return {
      kind: "blocked",
      inputTokens: complete.inputTokens,
      inputLimit,
      maxOutputTokens,
      reason: `${label}所需当前状态与完整本轮正文约 ${complete.inputTokens} token，超过辅助模型输入预算 ${inputLimit}；未发送请求，待处理事实仍保留。`,
    };
  }
  const base = build(cursor.processedThrough, true);
  if (base.inputTokens > inputLimit) {
    return {
      kind: "blocked",
      inputTokens: base.inputTokens,
      inputLimit,
      maxOutputTokens,
      reason: `${label}必要背景与当前正文约 ${base.inputTokens} token，已超过辅助模型输入预算 ${inputLimit}；没有发送请求或推进游标。`,
    };
  }
  let fitted: ReturnType<typeof build> | undefined;
  let through = cursor.processedThrough;
  for (const record of pending) {
    const candidate = build(record.seq, true);
    if (candidate.inputTokens > inputLimit) break;
    fitted = candidate;
    through = record.seq;
  }
  if (!fitted) {
    const first = pending[0];
    const oversized = build(first?.seq ?? seq, true);
    return {
      kind: "blocked",
      inputTokens: oversized.inputTokens,
      inputLimit,
      maxOutputTokens,
      reason: `${label}待处理回合 ${first?.seq ?? seq} 与必要背景约 ${oversized.inputTokens} token，超过辅助模型输入预算 ${inputLimit}；未截断或跳过该轮。`,
    };
  }
  return { kind: "ready", ...fitted, through, backlog: true, inputLimit, maxOutputTokens };
}
