import type { Draft } from "immer";
import type { ApplyOutcome, SystemContext } from "../../kernel/system";
import { type CyberwareState, cyberwareCatalog } from "../cyberware";
import { type HumanityState, PSYCHOSIS_BELOW } from "../humanity";
import type { InventoryState } from "../inventory";
import { formatGameTime, type WorldClockState } from "../world";
import {
  BLACKOUTS_KEPT,
  CRISIS_KEEP_COST,
  CRISIS_KEEP_PIECES,
  CRISIS_LABELS,
  CRISIS_RECOVERY,
  CRISIS_RESTORE,
  type CrisisCommand,
  DEPENDENCE_DOSES,
  DEPENDENCE_WINDOW,
  type EpisodeCommand,
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

/** 吞下一片压制剂：背包扣一件，记下服用时间；14 天前的记录丢掉 */
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
  const notes = [`压制剂起效到 ${formatGameTime(after.until ?? ctx.now)}`];
  if (after.tolerant && !before.tolerant) notes.push("一周里吃得太勤，开始耐受：药效变短");
  if (after.dependent && !before.dependent) {
    notes.push("两周里吃了太多次，已经依赖：停药一天就会戒断");
  }
  if (before.withdrawal) notes.push("戒断缓下来了");
  return {
    ok: true,
    notes,
    emit: [{ type: "item", action: "use", id: SUPPRESSANT_ID, reason: command.reason }],
  };
}

/** 发作：人性低于 40 才成立；一个场景最多一次，同一件事只一次；严重的开一段记忆空白 */
export function applyEpisode(
  draft: Draft<PsychosisState>,
  command: EpisodeCommand,
  ctx: SystemContext,
): ApplyOutcome {
  const humanity = ctx.read<HumanityState>("humanity").current;
  if (humanity >= PSYCHOSIS_BELOW) {
    return fail(`人性 ${humanity}，不低于 ${PSYCHOSIS_BELOW}，不会发作`);
  }
  const scene = ctx.read<WorldClockState>("world").scene;
  if (draft.episodeScene === scene) return fail("这个场景已经发作过一次");
  if (command.event !== undefined && draft.events.includes(command.event)) {
    return fail(`「${command.event}」这件事已经发作过`);
  }
  draft.episodeScene = scene;
  if (command.event !== undefined) draft.events.push(command.event);
  const notes = [`赛博精神病发作：${command.trigger}`];
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
  ctx: SystemContext,
): ApplyOutcome {
  const scene = ctx.read<WorldClockState>("world").scene;
  if (draft.episodeScene !== scene) return fail("这个场景没有发作，不会失控；先写 episode");
  draft.lostControl += 1;
  return { ok: true, notes: [`[失控] 你想：${command.intent}；实际：${command.actual}`] };
}

/** 场景结束：还开着的记忆空白到这里为止 */
export function closeBlackouts(draft: Draft<PsychosisState>, now: number): void {
  for (const b of draft.blackouts) if (b.to === null) b.to = now;
}

function isSevereEpisode(command: unknown): boolean {
  if (typeof command !== "object" || command === null) return false;
  const c = command as { type?: unknown; severity?: unknown };
  return c.type === "episode" && c.severity === "severe";
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

/** 危机章节里（还没被拉回来）：普通委托暂停 */
export function inCrisis(state: Partial<Pick<PsychosisState, "crisis">> | undefined): boolean {
  const status = state?.crisis?.status;
  return status === "open" || status === "lastStand";
}

/** 人性归零：打开危机章节；已经在危机里、最后一战或投降了就不再开 */
export function openCrisis(draft: Draft<PsychosisState>, now: number): void {
  const status = draft.crisis?.status;
  if (status === "open" || status === "lastStand" || status === "surrendered") return;
  draft.crisis = { since: now, status: "open", until: null };
  draft.crises += 1;
}

/** 恢复期满了：危机章节结束 */
export function tickCrisis(draft: Draft<PsychosisState>, to: number): void {
  const crisis = draft.crisis;
  if (crisis?.status === "recovering" && crisis.until !== null && to >= crisis.until) {
    draft.crisis = null;
  }
}

/** 被拉回来时拆哪几件：按人性消耗从低到高留最多 2 件、合计不超过 30，其余都拆 */
export function crisisRemovals(
  installed: readonly { readonly id: string }[],
  costOf: (id: string) => number,
): string[] {
  const sorted = [...installed].sort((a, b) => costOf(a.id) - costOf(b.id));
  const kept: string[] = [];
  let cost = 0;
  for (const c of sorted) {
    if (kept.length >= CRISIS_KEEP_PIECES || cost + costOf(c.id) > CRISIS_KEEP_COST) break;
    kept.push(c.id);
    cost += costOf(c.id);
  }
  return installed.map((c) => c.id).filter((id) => !kept.includes(id));
}

/** 危机章节的走向：拉回来、最后一战、投降 */
export function applyCrisis(
  draft: Draft<PsychosisState>,
  command: CrisisCommand,
  ctx: SystemContext,
): ApplyOutcome {
  const crisis = draft.crisis;
  if (!crisis || (crisis.status !== "open" && crisis.status !== "lastStand")) {
    return fail("现在不在危机章节里");
  }
  if (command.path === "lastStand") {
    if (crisis.status === "lastStand") return fail("已经走上最后一战了");
    crisis.status = "lastStand";
    return { ok: true, notes: ["走向最后一战：带着全部义体，不再回头"] };
  }
  if (command.path === "surrender") {
    crisis.status = "surrendered";
    return { ok: true, notes: ["向暴恐机动队投降"] };
  }
  const catalog = cyberwareCatalog(ctx.data);
  const installed = ctx.read<CyberwareState>("cyberware").installed;
  const removed = crisisRemovals(installed, (id) => catalog.get(id)?.humanityCost ?? 0);
  crisis.status = "recovering";
  crisis.until = ctx.now + CRISIS_RECOVERY;
  const who = command.who ? `${command.who}把你拉了回来` : "被拉了回来";
  return {
    ok: true,
    notes: [
      `${who}：人性回到 ${CRISIS_RESTORE}，恢复期到 ${formatGameTime(crisis.until)}`,
      removed.length > 0
        ? `拆掉了 ${removed.map((id) => catalog.get(id)?.name ?? id).join("、")}`
        : "身上没有要拆的义体",
    ],
    emit: [
      ...removed.map((id) => ({
        type: "cyberware",
        action: "remove",
        id,
        reason: `危机章节：${command.reason}`,
      })),
      { type: "humanity.restore", value: CRISIS_RESTORE },
    ],
  };
}

/** 给界面和提示词的压制剂、发作、危机情况 */
export function psychosisView(slice: unknown, now: number, scene: number | null = null) {
  const state = PsychosisStateSchema.parse(slice ?? {});
  const s = suppressantStatus(state.doses, now);
  return {
    /** 这个场景已经发作过 */
    episodeHere: scene !== null && state.episodeScene === scene,
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
    crisis:
      state.crisis === null
        ? null
        : {
            status: state.crisis.status,
            label: CRISIS_LABELS[state.crisis.status],
            since: formatGameTime(state.crisis.since),
            until: state.crisis.until === null ? null : formatGameTime(state.crisis.until),
          },
    suppressant: {
      until: s.until === null ? null : formatGameTime(s.until),
      tolerant: s.tolerant,
      dependent: s.dependent,
      withdrawal: s.withdrawal,
    },
  };
}
