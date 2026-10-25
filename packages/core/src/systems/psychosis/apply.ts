import type { Draft } from "immer";
import type { ApplyOutcome, SystemContext } from "../../kernel/system";
import { HUMANITY_KINDS, type HumanityState, PSYCHOSIS_BELOW } from "../humanity";
import type { InventoryState } from "../inventory";
import type { NpcState } from "../npc";
import { formatGameTime, type WorldClockState } from "../world";
import {
  ANCHOR_LOSS_LABELS,
  ANCHORS_MAX,
  type AnchorCommand,
  BLACKOUTS_KEPT,
  DEPENDENCE_DOSES,
  DEPENDENCE_WINDOW,
  type EpisodeCommand,
  type LostControlCommand,
  LostControlCommandSchema,
  type PsychosisInternal,
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

const anchored = (draft: Draft<PsychosisState>) => ({
  type: "humanity.setAnchored",
  anchored: draft.anchors.length > 0,
});

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

/** 玩家在人物卡上设锚点或取消；取消不扣人性（决裂和死去由叙事模型写 anchor） */
export function setAnchor(
  draft: Draft<PsychosisState>,
  command: Extract<PsychosisInternal, { type: "psychosis.anchor" }>,
  ctx: SystemContext,
): ApplyOutcome {
  const npc = Object.values(ctx.read<NpcState>("npc").npcs).find((n) => n.id === command.npc);
  const name = npc?.name ?? command.npc;
  if (command.action === "remove") {
    const index = draft.anchors.findIndex((a) => a.npc === command.npc);
    if (index < 0) return fail(`${name}不是锚点`);
    draft.anchors.splice(index, 1);
    return { ok: true, notes: [`${name}不再是锚点`], emit: [anchored(draft)] };
  }
  if (!npc) return fail(`没有人物卡 ${command.npc}`);
  if (!npc.alive) return fail(`${npc.name}已经不在了`);
  if (!npc.met) return fail(`还没见过${npc.name}`);
  if (draft.anchors.some((a) => a.npc === npc.id)) return fail(`${npc.name}已经是锚点`);
  if (draft.anchors.length >= ANCHORS_MAX) {
    return fail(`锚点最多 ${ANCHORS_MAX} 个，先取消一个`);
  }
  draft.anchors.push({ npc: npc.id, name: npc.name, since: ctx.now });
  return {
    ok: true,
    notes: [`${npc.name}成了锚点：快撑不住的时候，这个人能把你拉回来`],
    emit: [anchored(draft)],
  };
}

/** 锚点死去或决裂：从锚点里去掉，人性 −15，同一个人只扣一次 */
export function loseAnchor(
  draft: Draft<PsychosisState>,
  command: AnchorCommand,
  ctx: SystemContext,
): ApplyOutcome {
  const index = draft.anchors.findIndex((a) => a.npc === command.npc);
  const gone = draft.anchors[index];
  if (index < 0 || !gone) {
    const list = draft.anchors.map((a) => a.npc).join("、");
    return fail(`${command.npc} 不是锚点；现在的锚点：${list || "没有"}`);
  }
  const entry = { npc: gone.npc, name: gone.name, since: gone.since };
  draft.anchors.splice(index, 1);
  draft.lost.push({ ...entry, at: ctx.now, how: command.how });
  const how = ANCHOR_LOSS_LABELS[command.how];
  return {
    ok: true,
    notes: [`失去锚点：${entry.name}（${how}）`],
    emit: [
      {
        type: "humanity",
        delta: HUMANITY_KINDS.anchor.sizes.medium,
        reason: `失去锚点${entry.name}（${how}）：${command.reason}`,
        event: `anchor:${entry.npc}`,
      },
      anchored(draft),
    ],
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

/** 给界面和提示词的锚点、压制剂、发作情况 */
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
    anchors: state.anchors.map((a) => ({
      npc: a.npc,
      name: a.name,
      since: formatGameTime(a.since),
    })),
    lost: state.lost.map((l) => ({
      npc: l.npc,
      name: l.name,
      how: ANCHOR_LOSS_LABELS[l.how],
      at: formatGameTime(l.at),
    })),
    max: ANCHORS_MAX,
    suppressant: {
      until: s.until === null ? null : formatGameTime(s.until),
      tolerant: s.tolerant,
      dependent: s.dependent,
      withdrawal: s.withdrawal,
    },
  };
}
