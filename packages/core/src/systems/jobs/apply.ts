import type { Draft } from "immer";
import type { ApplyOutcome, Command, TimeSpan } from "../../kernel/system";
import type { NpcState } from "../npc";
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
  expired: "已过期",
  ...JOB_OUTCOME_LABELS,
};

/** 派单人所属势力的态度：见面就打和敌对的不派单 */
export function fixerBlocked(attitude: string | undefined): boolean {
  return attitude === "kos" || attitude === "hostile";
}

export function isOpen(job: Pick<Job, "status">): boolean {
  return job.status === "offered" || job.status === "active";
}

export function seedFixer(draft: Draft<JobsState>, command: SeedFixer): ApplyOutcome {
  if (draft.fixers[command.id]) return fail(`中间人 ${command.id} 已经存在`);
  draft.fixers[command.id] = { id: command.id, name: command.name };
  return { ok: true };
}

/** 派单人的人物卡：查势力态度、自动登记中间人用 */
export interface FixerCard {
  readonly name: string;
  readonly alive: boolean;
  readonly affinity: number;
  /** 派单人所属势力对玩家的态度；不属于势力表里的势力时没有 */
  readonly faction?: { readonly name: string; readonly attitude: string } | undefined;
}

/**
 * cardOf：按 id 查人物卡，没有卡是 undefined。
 * fixer 还没登记、但有同 id 的活人物卡时，在这里登记成中间人（用户定的，2026-10-30："llm 也要能生成中间人"）：
 * 模型先用 npc 建卡、再在 jobOffer 写 fixer 就行；旧存档里有卡没登记的罗格、和歌子等也走这条路
 */
export function offerJob(
  draft: Draft<JobsState>,
  command: JobOffer,
  now: number,
  cardOf: (id: string) => FixerCard | undefined,
): ApplyOutcome {
  if (draft.jobs.some((j) => j.id === command.id)) return fail(`委托 ${command.id} 已经存在`);
  if (command.due !== undefined && command.due <= now) {
    return fail(`期限必须晚于现在（${formatGameTime(now)}）`);
  }
  const notes: string[] = [];
  let fixer = command.fixer === undefined ? undefined : draft.fixers[command.fixer];
  if (command.fixer !== undefined && !fixer) {
    const card = cardOf(command.fixer);
    if (!card) {
      return fail(
        `没有中间人 ${command.fixer}：先用 npc 给派单的人建卡（role 写中间人），再在 fixer 写这张卡的 id`,
      );
    }
    if (!card.alive) return fail(`${card.name}已经死了，不能派单`);
    draft.fixers[command.fixer] = { id: command.fixer, name: card.name };
    fixer = draft.fixers[command.fixer];
    notes.push(`登记中间人：${card.name}`);
  }
  if (fixer) {
    const card = cardOf(fixer.id);
    if (card && !card.alive) return fail(`${card.name}已经死了，不能派单`);
    const side = card?.faction;
    if (side !== undefined && fixerBlocked(side.attitude)) {
      return fail(`${fixer.name}是${side.name}的人，${side.name}现在和玩家结了仇，不会给玩家派单`);
    }
  }
  draft.jobs.push({
    id: command.id,
    title: command.title,
    kind: command.kind ?? null,
    fixer: command.fixer ?? null,
    // 托事人与约定持续记在档案里；关系后果依据实际交往单独记录
    asker: command.fixer === undefined ? (command.asker ?? null) : null,
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
    notes: [...notes, `新委托：${command.title}（${command.reward} 欧元）`],
  };
}

function find(draft: Draft<JobsState>, id: string): Draft<Job> | undefined {
  return draft.jobs.find((j) => j.id === id);
}

export function acceptJob(draft: Draft<JobsState>, command: JobAccept, now: number): ApplyOutcome {
  const job = find(draft, command.id);
  if (!job) return fail(`没有委托 ${command.id}`);
  if (job.status !== "offered") {
    return fail(`委托 ${job.title} 现在是「${JOB_STATUS_LABELS[job.status]}」，不能再接`);
  }
  job.status = "active";
  job.acceptedAt = now;
  job.humanityAtAccept = null;
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

/** 记录约定结果和实际到款；不按任务结局自动兑换声望或好感。 */
export function endJob(
  draft: Draft<JobsState>,
  command: JobEnd,
  now: number,
  npcs: NpcState["npcs"],
  squad: readonly { npc: string; name: string; kind: string; share: number }[] = [],
): ApplyOutcome {
  const job = find(draft, command.id);
  if (!job) return fail(`没有委托 ${command.id}`);
  if (job.status !== "active") {
    return fail(
      `委托 ${job.title} 现在是「${JOB_STATUS_LABELS[job.status]}」，只有进行中的委托能结束`,
    );
  }
  const label = JOB_OUTCOME_LABELS[command.outcome];
  const paid = command.paid ?? 0;
  job.status = command.outcome;
  job.closedAt = now;
  job.paid = paid;
  job.summary = command.summary;
  const notes = [`委托${label}：${job.title}`];
  const emit: Command[] =
    paid > 0
      ? [{ type: "money", delta: paid, reason: `委托报酬：${job.title}`, event: `job:${job.id}` }]
      : [];
  const cuts: { name: string; cut: number }[] = [];
  for (const m of squad) {
    if (m.kind !== "friend" || m.share <= 0 || paid <= 0 || !npcs[m.npc]?.alive) continue;
    const cut = Math.floor((paid * m.share) / 100);
    if (cut <= 0) continue;
    cuts.push({ name: m.name, cut });
    emit.push({
      type: "money",
      delta: -cut,
      reason: `小队分账：${m.name}（${m.share}%）`,
      event: `job:${job.id}:squad:${m.npc}`,
    });
  }
  if (cuts.length > 0) {
    const total = cuts.reduce((sum, c) => sum + c.cut, 0);
    notes.push(
      `小队分账：${cuts.map((c) => `${c.name} ${c.cut.toLocaleString("en-US")}`).join("、")}；到手 ${(paid - total).toLocaleString("en-US")}`,
    );
  }
  job.settlement = {
    squad: cuts,
    credHalves: 0,
    affinity: null,
    humanity: null,
  };
  return { ok: true, notes, emit };
}

/** 时间推进只记自然逾期；是否有人接走、雇主如何回应必须有实际事件。 */
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
