import type { Draft } from "immer";
import type { ApplyOutcome, Command, TimeSpan } from "../../kernel/system";
import { AFFINITY_MAX, AFFINITY_MIN, type NpcState } from "../npc";
import { formatGameTime } from "../world";
import type {
  Job,
  JobAccept,
  JobEnd,
  JobNote,
  JobOffer,
  JobOutcome,
  JobStatus,
  JobsState,
  SeedFixer,
} from "./schema";

const fail = (reason: string): ApplyOutcome => ({ ok: false, reason });

export const JOB_OUTCOME_LABELS: Readonly<Record<JobOutcome, string>> = {
  clean: "干净完成",
  flawed: "带瑕疵完成",
  abandoned: "放弃",
  failed: "失败",
  betrayed: "背叛雇主",
};

export const JOB_STATUS_LABELS: Readonly<Record<JobStatus, string>> = {
  offered: "待接",
  active: "进行中",
  expired: "被别人接走",
  ...JOB_OUTCOME_LABELS,
};

/** 委托结局对中间人好感的影响；中间人要有见过面、还活着的人物卡才算 */
export const AFFINITY_CHANGE: Readonly<Record<JobOutcome, number>> = {
  clean: 5,
  flawed: 2,
  abandoned: -2,
  failed: -5,
  betrayed: -10,
};

/** 完成一单得到的街头声望，按半级计：1 星半级到 5 星三级；带瑕疵完成减半 */
export const CRED_HALVES: Readonly<Record<number, number>> = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 6 };

/** 能接的星级取街头声望和中间人好感两者中较低的一项 */
export function starsByCred(cred: number): number {
  if (cred >= 35) return 5;
  if (cred >= 20) return 4;
  if (cred >= 10) return 3;
  return 2;
}

export function starsByAffinity(affinity: number): number {
  if (affinity >= 70) return 5;
  if (affinity >= 40) return 4;
  if (affinity >= 20) return 3;
  return 2;
}

export function maxRisk(affinity: number, streetCred: number): number {
  return Math.min(starsByCred(streetCred), starsByAffinity(affinity));
}

const CRED_STEPS = [
  { at: 10, stars: 3 },
  { at: 20, stars: 4 },
  { at: 35, stars: 5 },
] as const;
const AFFINITY_STEPS = [
  { at: 20, stars: 3 },
  { at: 40, stars: 4 },
  { at: 70, stars: 5 },
] as const;

export interface RiskCap {
  readonly max: number;
  /** 卡在哪一项；两项一样或已经到 5 星时为 null */
  readonly by: "cred" | "affinity" | null;
  /** 要多接一星差什么，界面直接显示 */
  readonly hint: string | null;
}

/** 能接的星级卡在哪一项、再往上要什么，委托板标明 */
export function riskCap(affinity: number, streetCred: number): RiskCap {
  const byCred = starsByCred(streetCred);
  const byAffinity = starsByAffinity(affinity);
  const max = Math.min(byCred, byAffinity);
  if (max >= 5) return { max, by: null, hint: null };
  const cred = CRED_STEPS.find((s) => s.stars === max + 1);
  const liking = AFFINITY_STEPS.find((s) => s.stars === max + 1);
  const needs: string[] = [];
  if (byCred <= max && cred) needs.push(`街头声望 ${cred.at} 级`);
  if (byAffinity <= max && liking) needs.push(`中间人好感 ${liking.at}`);
  const by = byCred === byAffinity ? null : byCred < byAffinity ? "cred" : "affinity";
  return { max, by, hint: `需要${needs.join("和")}，才能接 ${max + 1} 星` };
}

export function isOpen(job: Pick<Job, "status">): boolean {
  return job.status === "offered" || job.status === "active";
}

export function seedFixer(draft: Draft<JobsState>, command: SeedFixer): ApplyOutcome {
  if (draft.fixers[command.id]) return fail(`中间人 ${command.id} 已经存在`);
  draft.fixers[command.id] = { id: command.id, name: command.name };
  return { ok: true };
}

/** affinityOf：按中间人 id 查好感，没有人物卡的算 0 */
export function offerJob(
  draft: Draft<JobsState>,
  command: JobOffer,
  now: number,
  streetCred: number,
  affinityOf: (id: string) => number,
): ApplyOutcome {
  if (draft.jobs.some((j) => j.id === command.id)) return fail(`委托 ${command.id} 已经存在`);
  if (command.due !== undefined && command.due <= now) {
    return fail(`期限必须晚于现在（${formatGameTime(now)}）`);
  }
  const fixer = command.fixer === undefined ? undefined : draft.fixers[command.fixer];
  if (command.fixer !== undefined && !fixer) return fail(`没有中间人 ${command.fixer}`);
  if (fixer) {
    const affinity = affinityOf(fixer.id);
    const max = maxRisk(affinity, streetCred);
    if (command.risk > max) {
      return fail(
        `${fixer.name}现在最多派 ${max} 星的活（街头声望 ${streetCred} 级、好感 ${affinity}），这单是 ${command.risk} 星`,
      );
    }
  }
  draft.jobs.push({
    id: command.id,
    title: command.title,
    kind: command.kind ?? null,
    fixer: command.fixer ?? null,
    client: command.client,
    location: command.location ?? null,
    risk: command.risk,
    reward: command.reward,
    due: command.due ?? null,
    conflict: command.conflict,
    twist: command.twist ?? null,
    notes: [],
    status: "offered",
    offeredAt: now,
    acceptedAt: null,
    closedAt: null,
    overdue: false,
    dueHandled: false,
    paid: null,
    summary: null,
    humanityAtAccept: null,
    settlement: null,
  });
  return {
    ok: true,
    notes: [`新委托：${command.title}（${command.risk} 星，${command.reward} 欧元）`],
  };
}

function find(draft: Draft<JobsState>, id: string): Draft<Job> | undefined {
  return draft.jobs.find((j) => j.id === id);
}

export function acceptJob(
  draft: Draft<JobsState>,
  command: JobAccept,
  now: number,
  humanity: number,
): ApplyOutcome {
  const job = find(draft, command.id);
  if (!job) return fail(`没有委托 ${command.id}`);
  if (job.status !== "offered") {
    return fail(`委托 ${job.title} 现在是「${JOB_STATUS_LABELS[job.status]}」，不能再接`);
  }
  job.status = "active";
  job.acceptedAt = now;
  job.humanityAtAccept = humanity;
  return { ok: true, notes: [`接下委托：${job.title}`] };
}

export function noteJob(draft: Draft<JobsState>, command: JobNote): ApplyOutcome {
  const job = find(draft, command.id);
  if (!job) return fail(`没有委托 ${command.id}`);
  if (!isOpen(job)) return fail(`委托 ${job.title} 已经结束`);
  job.notes.push(command.note);
  if (job.overdue) job.dueHandled = true;
  return { ok: true };
}

/** 委托结束：写结局和总评；报酬交给欧元系统，声望交给角色系统，中间人好感交给人物系统；结算记在委托上 */
export function endJob(
  draft: Draft<JobsState>,
  command: JobEnd,
  now: number,
  humanity: number,
  npcs: NpcState["npcs"],
): ApplyOutcome {
  const job = find(draft, command.id);
  if (!job) return fail(`没有委托 ${command.id}`);
  if (job.status !== "active") {
    return fail(
      `委托 ${job.title} 现在是「${JOB_STATUS_LABELS[job.status]}」，只有进行中的委托能结束`,
    );
  }
  const label = JOB_OUTCOME_LABELS[command.outcome];
  const done = command.outcome === "clean" || command.outcome === "flawed";
  const paid = command.paid ?? (done ? job.reward : 0);
  job.status = command.outcome;
  job.closedAt = now;
  job.paid = paid;
  job.summary = command.summary;
  const notes = [`委托${label}：${job.title}`];
  const emit: Command[] =
    paid > 0
      ? [{ type: "money", delta: paid, reason: `委托报酬：${job.title}`, event: `job:${job.id}` }]
      : [];
  const full = CRED_HALVES[job.risk] ?? 1;
  const credHalves = done ? (command.outcome === "clean" ? full : Math.ceil(full / 2)) : 0;
  if (credHalves > 0) {
    emit.push({
      type: "character.cred",
      halves: credHalves,
      reason: `委托${label}`,
      event: `job:${job.id}`,
    });
  }
  let affinity: { from: number; to: number } | null = null;
  if (job.fixer !== null) {
    const card = npcs[job.fixer];
    if (card?.met && card.alive) {
      const delta = AFFINITY_CHANGE[command.outcome];
      affinity = {
        from: card.affinity,
        to: Math.min(AFFINITY_MAX, Math.max(AFFINITY_MIN, card.affinity + delta)),
      };
      emit.push({ type: "affinity", id: job.fixer, delta, reason: `委托${label}` });
    }
  }
  job.settlement = {
    credHalves,
    affinity,
    humanity: job.humanityAtAccept === null ? null : humanity - job.humanityAtAccept,
  };
  return { ok: true, notes, emit };
}

/** 时间推进：没接的单子到期被别人接走；接下的超期只做标记，由叙事模型在正文里回应 */
export function tickJobs(draft: Draft<JobsState>, span: TimeSpan): void {
  for (const job of draft.jobs) {
    if (job.due === null || job.due > span.to) continue;
    if (job.status === "offered") {
      job.status = "expired";
      job.closedAt = job.due;
    } else if (job.status === "active") {
      job.overdue = true;
    }
  }
}
