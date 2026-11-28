import type { Draft } from "immer";
import type { ApplyOutcome, Command, TimeSpan } from "../../kernel/system";
import { formatGameTime } from "../world";
import type {
  Job,
  JobAccept,
  JobCrew,
  JobCrewStatus,
  JobEnd,
  JobNote,
  JobOffer,
  JobOutcome,
  JobStatus,
  JobsState,
  SeedFixer,
} from "./schema";

const fail = (reason: string): ApplyOutcome => ({ ok: false, reason });

export const JOB_CREW_STATUS_LABELS: Readonly<Record<JobCrewStatus, string>> = {
  joined: "已入伙",
  paid: "已分账",
  shorted: "被克扣",
  left: "已离队",
};

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
  /** 派单人所属势力对玩家的态度；不属于势力表里的势力时没有 */
  readonly faction?:
    | { readonly name: string; readonly attitude: string; readonly member?: boolean }
    | undefined;
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
    crew: [],
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

/** 合伙搭档的人物卡核验信息 */
export interface CrewCandidate {
  readonly name: string;
  readonly alive: boolean;
  readonly met: boolean;
  readonly hasGrudge: boolean;
}

const JOB_CREW_MAX = 6;
const JOB_CREW_CUT_TOTAL_MAX = 90;

/** 委托小队入伙或离队：校验人物存活、已结识、无未解死仇且总分成不超 90% */
export function crewJob(
  draft: Draft<JobsState>,
  command: JobCrew,
  candidateOf: (id: string) => CrewCandidate | undefined,
): ApplyOutcome {
  const job = find(draft, command.id);
  if (!job) return fail(`没有委托 ${command.id}`);
  if (!isOpen(job)) return fail(`委托 ${job.title} 已经结束，不能调整小队成员`);
  if (!job.crew) job.crew = [];

  if (command.action === "leave") {
    const member = job.crew.find((m) => m.npc === command.npc && m.status === "joined");
    if (!member) return fail(`${command.npc} 当前不在委托「${job.title}」小队中`);
    member.status = "left";
    return { ok: true, notes: [`${member.name} 退出委托「${job.title}」小队`] };
  }

  const person = candidateOf(command.npc);
  if (!person) return fail(`没有人物 ${command.npc}，请先建卡再安排入伙`);
  if (!person.alive) return fail(`${person.name}已经死了，无法入伙`);
  if (!person.met) return fail(`尚未结识 ${person.name}，先在剧情里碰面谈妥再入伙`);
  if (person.hasGrudge) return fail(`${person.name}对玩家还记着未解的仇，不会合伙干活`);

  const cutPercent = command.cutPercent ?? 0;
  const role = command.role ?? "搭档";
  const existing = job.crew.find((m) => m.npc === command.npc);
  const otherCut = job.crew
    .filter((m) => m.status === "joined" && m.npc !== command.npc)
    .reduce((sum, m) => sum + m.cutPercent, 0);
  if (otherCut + cutPercent > JOB_CREW_CUT_TOTAL_MAX) {
    return fail(
      `小队总分成比例不能超过 ${JOB_CREW_CUT_TOTAL_MAX}%（当前其余成员已占 ${otherCut}%）`,
    );
  }

  if (existing) {
    existing.name = person.name;
    existing.role = role;
    existing.cutPercent = cutPercent;
    existing.status = "joined";
    existing.paid = null;
  } else {
    if (job.crew.length >= JOB_CREW_MAX) {
      return fail(`单笔委托小队最多登记 ${JOB_CREW_MAX} 名搭档`);
    }
    job.crew.push({
      npc: command.npc,
      name: person.name,
      role,
      cutPercent,
      paid: null,
      status: "joined",
    });
  }

  const cutText = cutPercent > 0 ? `，约定分成 ${cutPercent}%` : "（义气帮忙，不分账）";
  return {
    ok: true,
    notes: [`${person.name} 入伙委托「${job.title}」：${role}${cutText}`],
  };
}

/** 记录约定结果和实际到款：有入伙搭档时按约定分成自动扣减并入账玩家净到手，故意克扣则自动在原 npc 账本记欠账。 */
export function endJob(draft: Draft<JobsState>, command: JobEnd, now: number): ApplyOutcome {
  const job = find(draft, command.id);
  if (!job) return fail(`没有委托 ${command.id}`);
  if (job.status !== "offered" && job.status !== "active") {
    return fail(
      `委托 ${job.title} 现在是「${JOB_STATUS_LABELS[job.status]}」，已经结束，不能再重复结算`,
    );
  }
  const label = JOB_OUTCOME_LABELS[command.outcome];
  const paid = command.paid ?? 0;
  const notes = [`委托${label}：${job.title}`];
  const emit: Command[] = [];
  const overrides = new Map((command.crewPayouts ?? []).map((p) => [p.npc, p.paid] as const));
  if (overrides.size !== (command.crewPayouts?.length ?? 0))
    return fail("同一搭档不能重复登记实付分成");
  const joined = (job.crew ?? []).filter((member) => member.status === "joined");
  if ([...overrides.keys()].some((npc) => !joined.some((member) => member.npc === npc)))
    return fail("实付分成只能指定本单仍在小队中的搭档");
  const plannedCrewPaid = joined.reduce(
    (total, member) =>
      total + (overrides.get(member.npc) ?? Math.floor((paid * member.cutPercent) / 100)),
    0,
  );
  if (plannedCrewPaid > paid)
    return fail(`搭档实付分成合计 ${plannedCrewPaid} 欧元，超过本单实际到账 ${paid} 欧元`);

  // 待接委托也允许直接办完或推掉，但所有分账条件成立后才写入结单状态。
  if (job.status === "offered" && command.outcome !== "abandoned")
    job.acceptedAt = job.acceptedAt ?? now;
  job.status = command.outcome;
  job.closedAt = now;
  job.paid = paid;
  job.summary = command.summary;

  let totalCrewPaid = 0;
  const splitParts: string[] = [];
  for (const member of job.crew ?? []) {
    if (member.status !== "joined") continue;
    const expected = Math.floor((paid * member.cutPercent) / 100);
    const hasOverride = overrides.has(member.npc);
    const actual = hasOverride ? (overrides.get(member.npc) ?? 0) : paid > 0 ? expected : 0;
    member.paid = actual;
    totalCrewPaid += actual;

    if (paid > 0 && actual < expected) {
      const owe = expected - actual;
      member.status = "shorted";
      splitParts.push(`${member.name}实分 ${actual} €（少给 ${owe} €）`);
      emit.push(
        {
          type: "ledger",
          id: member.npc,
          kind: "youOwe",
          text: `委托「${job.title}」约定分成 ${expected} 欧元，实付 ${actual} 欧元（尚欠 ${owe} 欧元）`.slice(
            0,
            120,
          ),
        },
        {
          type: "memory",
          id: member.npc,
          text: `合伙完成委托「${job.title}」时被少分了 ${owe} 欧元分成`.slice(0, 120),
        },
      );
    } else {
      member.status = "paid";
      if (actual > 0) splitParts.push(`${member.name} ${actual} €（${member.cutPercent}%）`);
    }
  }

  const playerNet = paid - totalCrewPaid;
  if (playerNet > 0) {
    const moneyReason =
      totalCrewPaid > 0
        ? `委托净报酬：${job.title}（总 ${paid} €，搭档分成 ${totalCrewPaid} €）`
        : `委托报酬：${job.title}`;
    emit.push({ type: "money", delta: playerNet, reason: moneyReason, event: `job:${job.id}` });
  }
  if (splitParts.length > 0) {
    notes.push(`小队分账：${splitParts.join("、")}；玩家净到手 ${playerNet} 欧元`);
  }

  job.settlement = {
    humanity: null,
    playerNet,
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
