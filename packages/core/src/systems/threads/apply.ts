import type { Draft } from "immer";
import type { ApplyOutcome, Command, SystemContext } from "../../kernel/system";
import { type ArcsState, arcCatalog, arcOf, concernOf } from "../arcs";
import {
  agendaCatalog,
  currentTurf,
  type FactionsState,
  factionCatalog,
  threadTurfProblem,
} from "../factions";
import type { NemesisState } from "../nemesis";
import type { NpcState } from "../npc";
import {
  THREAD_MOVE_LABELS,
  THREAD_NEMESIS_DAYS,
  THREAD_SNOOZE_DAYS,
  THREAD_STALL_DAYS,
  THREAD_STEPS_KEPT,
  THREADS_CLOSED_KEPT,
  THREADS_MAX,
  type Thread,
  type ThreadClose,
  type ThreadCommand,
  type ThreadDefer,
  type ThreadOpen,
  type ThreadStep,
  type ThreadStepCommand,
  type ThreadsState,
  type ThreadTold,
} from "./schema";

type State = Draft<ThreadsState>;

const DAY = 24 * 60;
const fail = (reason: string): ApplyOutcome => ({ ok: false, reason });

export function openThread(state: ThreadsState, id: string): Thread | undefined {
  return state.threads.find((t) => t.id === id);
}

function pushStep(t: Draft<Thread>, step: ThreadStep): void {
  t.steps.push(step);
  if (t.steps.length > THREAD_STEPS_KEPT) t.steps.splice(0, t.steps.length - THREAD_STEPS_KEPT);
}

/** 开锅前核对主人：势力要有卡、种子要是它的；宿敌要在名单上；心事要是这个人的、还没有结果 */
function ownerProblem(command: ThreadOpen, ctx: SystemContext): string | undefined {
  if (command.kind === "faction") {
    if (!factionCatalog(ctx.data).has(command.owner)) return `没有 ${command.owner} 这个势力`;
    if (command.seed === null) return undefined;
    const seed = agendaCatalog(ctx.data).get(command.seed);
    if (!seed || seed.faction !== command.owner)
      return `${command.seed} 不是 ${command.owner} 的势力动向`;
    return undefined;
  }
  const card = ctx.read<NpcState>("npc").npcs[command.owner];
  if (!card?.alive) return `${command.owner} 没有卡或已经死了`;
  if (command.kind === "nemesis") {
    const rivals = ctx.read<NemesisState>("nemesis").nemeses;
    return rivals.some((n) => n.npc === command.owner) ? undefined : `${card.name}不是宿敌`;
  }
  const seed = arcCatalog(ctx.data).get(command.owner);
  const concern = seed?.concerns.find((c) => c.id === command.seed);
  if (!concern) return `${card.name}没有 ${command.seed ?? "（没写）"} 这件心事`;
  const arcs = ctx.read<ArcsState>("arcs");
  if (concernOf(arcOf(arcs, command.owner), concern.id).status === "resolved")
    return `「${concern.title}」已经有结果了`;
  return undefined;
}

function applyOpen(draft: State, command: ThreadOpen, ctx: SystemContext): ApplyOutcome {
  if (openThread(draft as ThreadsState, command.id)) return fail(`已经有 ${command.id} 这件事了`);
  if (
    command.seed !== null &&
    draft.threads.some((t) => t.kind === command.kind && t.seed === command.seed)
  )
    return fail(`${command.seed} 已经在单子上了`);
  if (
    command.kind === "nemesis" &&
    draft.threads.some((t) => t.kind === "nemesis" && t.owner === command.owner)
  )
    return fail(`${command.owner} 的报复已经在单子上了`);
  if (draft.threads.length >= THREADS_MAX)
    return fail(`单子上同时最多 ${THREADS_MAX} 件，先让一件收场`);
  const problem = ownerProblem(command, ctx);
  if (problem) return fail(problem);
  draft.threads.push({
    id: command.id,
    kind: command.kind,
    owner: command.owner,
    seed: command.seed,
    title: command.title,
    want: command.want,
    stage: command.stage,
    openedAt: ctx.now,
    dueAt: ctx.now + command.days * DAY,
    reminded: false,
    steps: [],
  });
  return { ok: true, notes: [`城里有件事开始发酵：${command.title}`] };
}

/**
 * 场外推演写下一步：记进这件事，表按主持人给的天数重新拨。
 * 势力的地盘变化按硬账核对，不合格的只去掉地盘、这一步照记；心事的一步交给心事系统记进展
 */
function applyStep(draft: State, command: ThreadStepCommand, ctx: SystemContext): ApplyOutcome {
  const t = draft.threads.find((x) => x.id === command.id);
  if (!t) return fail(`单子上没有 ${command.id} 这件事`);
  const notes: string[] = [];
  const emit: Command[] = [];
  let turf = command.turf;
  if (turf !== null) {
    const problem =
      t.kind !== "faction"
        ? "只有势力的事能改地盘"
        : threadTurfProblem(
            t.owner,
            t.seed === null ? undefined : agendaCatalog(ctx.data).get(t.seed),
            turf,
            currentTurf(ctx.read<FactionsState>("factions"), ctx.data),
            ctx.data,
          );
    if (problem) {
      notes.push(`「${t.title}」的地盘变化不算：${problem}`);
      turf = null;
    } else emit.push({ type: "faction.turf", thread: t.id, ...turf });
  }
  if (t.kind === "concern" && t.seed !== null)
    emit.push({
      type: "arc.offscreen",
      npc: t.owner,
      concern: t.seed,
      text: command.text,
      resolve: false,
    });
  pushStep(t, {
    at: ctx.now,
    kind: "move",
    text: command.text,
    news: command.news,
    turf,
    told: false,
  });
  if (command.stage) t.stage = command.stage;
  t.dueAt = ctx.now + command.days * DAY;
  t.reminded = false;
  return { ok: true, notes, emit };
}

/** 响了先不写：主持人给理由，表往后拨 */
function applyDefer(draft: State, command: ThreadDefer, ctx: SystemContext): ApplyOutcome {
  const t = draft.threads.find((x) => x.id === command.id);
  if (!t) return fail(`单子上没有 ${command.id} 这件事`);
  t.dueAt = ctx.now + command.days * DAY;
  t.reminded = false;
  return { ok: true, notes: [`「${t.title}」往后推了 ${command.days} 天：${command.why}`] };
}

/** 收场：挪进了结的单子，只留最近几件 */
function closeThread(draft: State, index: number, end: string, now: number): Thread {
  const t = draft.threads[index] as Draft<Thread>;
  draft.threads.splice(index, 1);
  draft.closed.push({ ...(t as Thread), closedAt: now, end });
  if (draft.closed.length > THREADS_CLOSED_KEPT)
    draft.closed.splice(0, draft.closed.length - THREADS_CLOSED_KEPT);
  return t as Thread;
}

/** 场外推演或别的系统让一件事收场；心事收场时交给心事系统记结果（玩家要听说了才知道） */
function applyClose(draft: State, command: ThreadClose, ctx: SystemContext): ApplyOutcome {
  const index = draft.threads.findIndex((x) => x.id === command.id);
  if (index < 0) return fail(`单子上没有 ${command.id} 这件事`);
  const t = closeThread(draft, index, command.end, ctx.now);
  const emit: Command[] =
    t.kind === "concern" && t.seed !== null
      ? [
          {
            type: "arc.offscreen",
            npc: t.owner,
            concern: t.seed,
            text: command.end,
            resolve: true,
            fate: command.fate ?? "canon",
          },
        ]
      : [];
  return { ok: true, notes: [`「${t.title}」收场了：${command.end}`], emit };
}

/** 玩家插手：push 马上到点，stall 表往后拨，derail 这件事收场；插手过的玩家都知道 */
function applyPlayer(draft: State, command: ThreadCommand, ctx: SystemContext): ApplyOutcome {
  const index = draft.threads.findIndex((x) => x.id === command.id);
  const t = draft.threads[index];
  if (!t) return fail(`单子上没有 ${command.id} 这件事`);
  const last = t.steps.at(-1);
  if (last && last.at === ctx.now && last.kind !== "move")
    return fail(`「${t.title}」这一刻已经插过手了，一次只算一下`);
  const label = THREAD_MOVE_LABELS[command.move];
  pushStep(t, {
    at: ctx.now,
    kind: command.move,
    text: command.reason,
    news: command.reason,
    turf: null,
    told: true,
  });
  const notes = [`${t.title}：${label}`];
  if (command.move === "derail") {
    closeThread(draft, index, `玩家${label}：${command.reason}`, ctx.now);
    return { ok: true, notes };
  }
  t.dueAt =
    command.move === "push" ? ctx.now : Math.max(t.dueAt, ctx.now) + THREAD_STALL_DAYS * DAY;
  t.reminded = false;
  return { ok: true, notes };
}

/** 传到玩家耳朵里了：把还没听说的几步都记成听说了 */
function applyTold(draft: State, command: ThreadTold): ApplyOutcome {
  const t =
    draft.threads.find((x) => x.id === command.id) ?? draft.closed.find((x) => x.id === command.id);
  if (!t) return fail(`没有 ${command.id} 这件事`);
  const fresh = t.steps.filter((s) => !s.told);
  if (fresh.length === 0) return fail(`「${t.title}」没有玩家还没听说的事`);
  for (const s of fresh) s.told = true;
  // 听说势力的事时同步公开地盘账，避免正文和地图对不上（用户 2026-11-01 定的「全改」第 4 步）
  return {
    ok: true,
    notes: [`${t.title}：${fresh.at(-1)?.news ?? ""}`],
    emit: t.kind === "faction" ? [{ type: "faction.turfTold", thread: t.id }] : [],
  };
}

/**
 * 推演过一次以后：响了没写的记成提醒过，下次推演再提一次；提醒过还是没写的，代码不替它编，表往后拨
 */
function applyRemind(draft: State, now: number): ApplyOutcome {
  const notes: string[] = [];
  for (const t of draft.threads) {
    if (t.dueAt > now) continue;
    if (!t.reminded) t.reminded = true;
    else {
      t.dueAt = now + THREAD_SNOOZE_DAYS * DAY;
      t.reminded = false;
      notes.push(`「${t.title}」提醒过还没写，往后拨 ${THREAD_SNOOZE_DAYS} 天`);
    }
  }
  return { ok: true, notes };
}

/**
 * 时间推进时对宿敌的账：名单上新冒出来的宿敌开一件报复（单子有空位时），
 * 宿敌死了、了结了就收场。宿敌系统不依赖这里，由这里去看它的名单
 */
export function tickThreads(draft: State, ctx: SystemContext): void {
  const rivals = ctx.read<NemesisState>("nemesis").nemeses;
  const npcs = ctx.read<NpcState>("npc").npcs;
  for (let i = draft.threads.length - 1; i >= 0; i--) {
    const t = draft.threads[i] as Draft<Thread>;
    if (t.kind !== "nemesis") continue;
    const rival = rivals.find((n) => n.npc === t.owner);
    if (!rival || npcs[t.owner]?.alive === false)
      closeThread(draft, i, rival ? "他死了" : "恩怨了结了", ctx.now);
  }
  for (const n of rivals) {
    if (draft.threads.length >= THREADS_MAX) break;
    if (npcs[n.npc]?.alive === false) continue;
    if (draft.threads.some((t) => t.kind === "nemesis" && t.owner === n.npc)) continue;
    if (
      draft.closed.some((t) => t.kind === "nemesis" && t.owner === n.npc && t.openedAt >= n.since)
    )
      continue;
    draft.threads.push({
      id: `nemesis-${n.npc}`.slice(0, 40),
      kind: "nemesis",
      owner: n.npc,
      seed: null,
      title: `${n.name}的报复`.slice(0, 24),
      want: `找玩家算账：${n.how}`.slice(0, 120),
      stage: "刚输给玩家，在舔伤口",
      openedAt: ctx.now,
      dueAt: ctx.now + THREAD_NEMESIS_DAYS * DAY,
      reminded: false,
      steps: [],
    });
  }
}

export function applyThreads(
  draft: State,
  command:
    | ThreadCommand
    | ThreadTold
    | ThreadOpen
    | ThreadStepCommand
    | ThreadDefer
    | ThreadClose
    | { type: "thread.remind" },
  ctx: SystemContext,
): ApplyOutcome {
  switch (command.type) {
    case "thread":
      return applyPlayer(draft, command, ctx);
    case "threadTold":
      return applyTold(draft, command);
    case "thread.open":
      return applyOpen(draft, command, ctx);
    case "thread.step":
      return applyStep(draft, command, ctx);
    case "thread.defer":
      return applyDefer(draft, command, ctx);
    case "thread.close":
      return applyClose(draft, command, ctx);
    case "thread.remind":
      return applyRemind(draft, ctx.now);
  }
}
