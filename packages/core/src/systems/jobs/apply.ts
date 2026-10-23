import type { Draft } from "immer";
import type { ApplyOutcome, Command, TimeSpan } from "../../kernel/system";
import { formatGameTime } from "../world";
import {
  type Fixer,
  type Job,
  type JobAccept,
  type JobEnd,
  type JobNote,
  type JobOffer,
  type JobOutcome,
  type JobStatus,
  type JobsState,
  OVERDUE_TRUST,
  type SeedFixer,
  TRUST_MAX,
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

/** 委托结局对中间人信任度的影响 */
export const TRUST_CHANGE: Readonly<Record<JobOutcome, number>> = {
  clean: 10,
  flawed: 4,
  abandoned: -2,
  failed: -5,
  betrayed: -20,
};

/** 完成一单得到的街头声望，按半级计：1 星半级到 5 星三级；带瑕疵完成减半 */
export const CRED_HALVES: Readonly<Record<number, number>> = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 6 };

/** 能接的星级取街头声望和信任度两者中较低的一项 */
export function starsByCred(cred: number): number {
  if (cred >= 35) return 5;
  if (cred >= 20) return 4;
  if (cred >= 10) return 3;
  return 2;
}

export function starsByTrust(trust: number): number {
  if (trust >= 85) return 5;
  if (trust >= 60) return 4;
  if (trust >= 30) return 3;
  return 2;
}

export function maxRisk(fixer: Pick<Fixer, "trust">, streetCred: number): number {
  return Math.min(starsByCred(streetCred), starsByTrust(fixer.trust));
}

export function isOpen(job: Pick<Job, "status">): boolean {
  return job.status === "offered" || job.status === "active";
}

function changeTrust(
  fixer: Draft<Fixer>,
  delta: number,
): { from: number; to: number; note: string } {
  const from = fixer.trust;
  fixer.trust = Math.max(0, Math.min(TRUST_MAX, from + delta));
  return { from, to: fixer.trust, note: `${fixer.name}的信任度 ${from} → ${fixer.trust}` };
}

export function seedFixer(draft: Draft<JobsState>, command: SeedFixer): ApplyOutcome {
  if (draft.fixers[command.id]) return fail(`中间人 ${command.id} 已经存在`);
  draft.fixers[command.id] = { id: command.id, name: command.name, trust: command.trust };
  return { ok: true };
}

export function offerJob(
  draft: Draft<JobsState>,
  command: JobOffer,
  now: number,
  streetCred: number,
): ApplyOutcome {
  if (draft.jobs.some((j) => j.id === command.id)) return fail(`委托 ${command.id} 已经存在`);
  if (command.due !== undefined && command.due <= now) {
    return fail(`期限必须晚于现在（${formatGameTime(now)}）`);
  }
  const fixer = command.fixer === undefined ? undefined : draft.fixers[command.fixer];
  if (command.fixer !== undefined && !fixer) return fail(`没有中间人 ${command.fixer}`);
  if (fixer) {
    const max = maxRisk(fixer, streetCred);
    if (command.risk > max) {
      return fail(
        `${fixer.name}现在最多派 ${max} 星的活（街头声望 ${streetCred} 级、信任度 ${fixer.trust}），这单是 ${command.risk} 星`,
      );
    }
  }
  draft.jobs.push({
    id: command.id,
    title: command.title,
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
  return { ok: true };
}

/** 委托结束：写结局和总评，改信任度，到手的报酬交给欧元系统，声望交给角色系统；结算记在委托上 */
export function endJob(
  draft: Draft<JobsState>,
  command: JobEnd,
  now: number,
  humanity: number,
): ApplyOutcome {
  const job = find(draft, command.id);
  if (!job) return fail(`没有委托 ${command.id}`);
  if (job.status !== "active") {
    return fail(
      `委托 ${job.title} 现在是「${JOB_STATUS_LABELS[job.status]}」，只有进行中的委托能结束`,
    );
  }
  const done = command.outcome === "clean" || command.outcome === "flawed";
  const paid = command.paid ?? (done ? job.reward : 0);
  job.status = command.outcome;
  job.closedAt = now;
  job.paid = paid;
  job.summary = command.summary;
  const notes = [`委托${JOB_OUTCOME_LABELS[command.outcome]}：${job.title}`];
  const fixer = job.fixer === null ? undefined : draft.fixers[job.fixer];
  const trust = fixer ? changeTrust(fixer, TRUST_CHANGE[command.outcome]) : null;
  if (trust) notes.push(trust.note);
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
      reason: `委托${JOB_OUTCOME_LABELS[command.outcome]}`,
      event: `job:${job.id}`,
    });
  }
  job.settlement = {
    credHalves,
    trust: trust ? { from: trust.from, to: trust.to } : null,
    humanity: job.humanityAtAccept === null ? null : humanity - job.humanityAtAccept,
  };
  return { ok: true, notes, emit };
}

/** 时间推进：没接的单子到期被别人接走；接下的超期扣一次信任 */
export function tickJobs(draft: Draft<JobsState>, span: TimeSpan): void {
  for (const job of draft.jobs) {
    if (job.due === null || job.due > span.to) continue;
    if (job.status === "offered") {
      job.status = "expired";
      job.closedAt = job.due;
    } else if (job.status === "active" && !job.overdue) {
      job.overdue = true;
      const fixer = job.fixer === null ? undefined : draft.fixers[job.fixer];
      if (fixer) changeTrust(fixer, OVERDUE_TRUST);
    }
  }
}
