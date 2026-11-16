import type { Draft } from "immer";
import type { ApplyOutcome, SystemContext } from "../../kernel/system";
import { type HumanityState, isImmunosuppressed, neuralStage } from "../humanity";
import type { InventoryState } from "../inventory";
import { formatGameTime, type WorldClockState } from "../world";
import {
  BLACKOUTS_KEPT,
  DEPENDENCE_DOSES,
  DEPENDENCE_WINDOW,
  type EpisodeCommand,
  EpisodeCommandSchema,
  type LostControlCommand,
  LostControlCommandSchema,
  type PsychosisState,
  PsychosisStateSchema,
  SUPPRESSANT_ID,
  SUPPRESSANT_MINUTES,
  type SuppressantCommand,
  TOLERANCE_DOSES,
  TOLERANCE_WINDOW,
  WITHDRAWAL_AFTER,
} from "./schema";

const fail = (reason: string): ApplyOutcome => ({ ok: false, reason });

/** 压制剂现在的情况：药效到几点、耐受、依赖、戒断 */
export interface SuppressantStatus {
  readonly until: number | null;
  readonly tolerant: boolean;
  readonly dependent: boolean;
  readonly withdrawal: boolean;
}

export function suppressantStatus(doses: readonly number[], now: number): SuppressantStatus {
  const past = doses.filter((t) => t <= now);
  const last = past.length === 0 ? null : Math.max(...past);
  const week = past.filter((t) => now - t < TOLERANCE_WINDOW).length;
  const fortnight = past.filter((t) => now - t < DEPENDENCE_WINDOW).length;
  const tolerant = week >= TOLERANCE_DOSES;
  const length = tolerant ? SUPPRESSANT_MINUTES / 2 : SUPPRESSANT_MINUTES;
  const dependent = fortnight >= DEPENDENCE_DOSES;
  return {
    until: last !== null && now - last < length ? last + length : null,
    tolerant,
    dependent,
    withdrawal: dependent && last !== null && now - last >= WITHDRAWAL_AFTER,
  };
}

/** 吞下一片/注射一剂压制剂：背包扣一件，记下时间并同步压制 humanity 失真；14 天前的记录丢掉 */
export function takeSuppressant(
  draft: Draft<PsychosisState>,
  command: SuppressantCommand,
  ctx: SystemContext,
): ApplyOutcome {
  const backpack = ctx.read<InventoryState>("inventory").backpack;
  if ((backpack[SUPPRESSANT_ID] ?? 0) < 1) return fail("背包里没有压制剂");
  draft.doses = draft.doses.filter((t) => ctx.now - t < DEPENDENCE_WINDOW);
  const before = suppressantStatus(draft.doses, ctx.now);
  draft.doses.push(ctx.now);
  const after = suppressantStatus(draft.doses, ctx.now);
  const until = after.until ?? ctx.now;
  const durationMinutes = Math.max(30, until - ctx.now);
  const notes = [`压制剂起效到 ${formatGameTime(until)}`];
  if (after.tolerant && !before.tolerant) notes.push("一周里用得太勤，开始耐受：药效减半");
  if (after.dependent && !before.dependent) {
    notes.push("两周里用了太多次，已经依赖：停药一天就会戒断");
  }
  if (before.withdrawal) notes.push("戒断缓下来了");
  return {
    ok: true,
    notes,
    emit: [
      { type: "item", action: "use", id: SUPPRESSANT_ID, reason: command.reason },
      { type: "humanity.suppress", durationMinutes },
    ],
  };
}

/** 发作需要已确认的神经症状与新诱因；不受场景配额控制。 */
export function applyEpisode(
  draft: Draft<PsychosisState>,
  command: EpisodeCommand,
  ctx: SystemContext,
): ApplyOutcome {
  const humanityState = ctx.read<HumanityState>("humanity");
  if (command.action === "end") {
    if (draft.episodeScene === null) return fail("没有正在持续的发作");
    closeBlackouts(draft, ctx.now);
    draft.episodeScene = null;
    return { ok: true, notes: [`发作缓解：${command.trigger}`] };
  }
  const stage = neuralStage(humanityState);
  if (stage === "stable" || stage === "detached") return fail("尚无不稳定的神经症状，不能凭空发作");
  const suppressed =
    suppressantStatus(draft.doses, ctx.now).until !== null ||
    isImmunosuppressed(humanityState, ctx.now);
  if (suppressed && (stage !== "crisis" || command.severity === "mild")) {
    return fail("压制剂仍在起效，压住了这次神经失控");
  }
  const scene = ctx.read<WorldClockState>("world").scene;
  if (command.event !== undefined && draft.events.includes(command.event)) {
    return fail(`「${command.event}」这件事已经发作过`);
  }
  draft.episodeScene = scene;
  if (command.event !== undefined) draft.events.push(command.event);
  const notes = [
    suppressed
      ? `压制剂没能完全拦住临界状态下的剧烈发作：${command.trigger}`
      : `赛博精神病发作：${command.trigger}`,
  ];
  if (command.severity === "severe") {
    draft.blackouts.push({ scene, from: ctx.now, to: null });
    if (draft.blackouts.length > BLACKOUTS_KEPT) draft.blackouts.shift();
    notes.push("严重发作：这一段事后会记不清");
  }
  return { ok: true, notes };
}

/** 短暂失控：这个场景发作过才成立；说明里同时写意图和实际 */
export function applyLostControl(
  draft: Draft<PsychosisState>,
  command: LostControlCommand,
): ApplyOutcome {
  if (draft.episodeScene === null) return fail("没有正在持续的发作，不会失控；先写 episode");
  draft.lostControl += 1;
  return { ok: true, notes: [`[失控] 你想：${command.intent}；实际：${command.actual}`] };
}

/** 场景结束：还开着的记忆空白到这里为止 */
export function closeBlackouts(draft: Draft<PsychosisState>, now: number): void {
  for (const b of draft.blackouts) if (b.to === null) b.to = now;
}

function isSevereEpisode(command: unknown): boolean {
  if (typeof command !== "object" || command === null) return false;
  const c = command as { type?: unknown; severity?: unknown; action?: unknown };
  return c.type === "episode" && c.action !== "end" && c.severity === "severe";
}

/** 哪几轮落在已经结束的记忆空白里：那个场景从严重发作那一轮起，到场景结束 */
export function blackoutTurns(
  turns: readonly {
    readonly seq: number;
    readonly scene?: number | undefined;
    readonly commands: readonly unknown[];
  }[],
  slice: unknown,
): ReadonlySet<number> {
  const state = PsychosisStateSchema.parse(slice ?? {});
  const closed = new Set(state.blackouts.filter((b) => b.to !== null).map((b) => b.scene));
  const started = new Set<number>();
  const out = new Set<number>();
  for (const t of turns) {
    if (t.scene === undefined || !closed.has(t.scene)) continue;
    if (!started.has(t.scene) && t.commands.some(isSevereEpisode)) started.add(t.scene);
    if (started.has(t.scene)) out.add(t.seq);
  }
  return out;
}

/** 这一轮的发作：诱因和严重度；没有时为 null */
export function episodeOf(
  commands: readonly unknown[],
): { readonly severity: "mild" | "severe"; readonly trigger: string } | null {
  for (const c of commands) {
    const parsed = EpisodeCommandSchema.safeParse(c);
    if (parsed.success && parsed.data.action !== "end")
      return { severity: parsed.data.severity, trigger: parsed.data.trigger };
  }
  return null;
}

/** 这一轮的失控：玩家的意图和实际发生的事；没有时为 null */
export function lostControlOf(
  commands: readonly unknown[],
): { readonly intent: string; readonly actual: string } | null {
  for (const c of commands) {
    const parsed = LostControlCommandSchema.safeParse(c);
    if (parsed.success) return { intent: parsed.data.intent, actual: parsed.data.actual };
  }
  return null;
}

/** 给界面和提示词的压制剂、发作与记忆空白情况 */
export function psychosisView(slice: unknown, now: number) {
  const state = PsychosisStateSchema.parse(slice ?? {});
  const s = suppressantStatus(state.doses, now);
  return {
    /** 这个场景已经发作过 */
    episodeHere: state.episodeScene !== null,
    /** 严重发作还没过去 */
    blackoutOpen: state.blackouts.some((b) => b.to === null),
    /** 已经结束的记忆空白，最近 3 段 */
    blackouts: state.blackouts
      .filter((b) => b.to !== null)
      .slice(-3)
      .map((b) => ({
        scene: b.scene,
        from: formatGameTime(b.from),
        to: formatGameTime(b.to ?? b.from),
      })),
    lostControl: state.lostControl,
    suppressant: {
      until: s.until === null ? null : formatGameTime(s.until),
      tolerant: s.tolerant,
      dependent: s.dependent,
      withdrawal: s.withdrawal,
    },
  };
}
