/**
 * 履历和传说名册：履历把叙事模型写的段落、结束的委托、死亡和结束故事按游戏时间排在一起；
 * 角色死透了（不能再重来）或玩家结束了故事，就进传说名册。名册由服务端扫各存档现算，不另存一份
 */
import type { PlayerView } from "./game";
import {
  type ChronicleState,
  ENDING_LABELS,
  type Ending,
  LEGENDS_SEEDED,
  type LegendNote,
} from "./systems/chronicle/schema";
import { ATTRIBUTE_LABELS, type Attribute } from "./systems/dice/schema";
import { JOB_OUTCOME_LABELS } from "./systems/jobs/apply";
import type { Job, JobOutcome } from "./systems/jobs/schema";
import { formatGameTime } from "./systems/world/apply";

export type ChronicleKind = "arc" | "job" | "death" | "ended";

/** 履历里的一条；at 是游戏时间（分钟），time 是给人看的写法 */
export interface ChronicleEntry {
  readonly at: number;
  readonly time: string;
  readonly kind: ChronicleKind;
  readonly title: string;
  readonly text: string;
  /** 委托那一条的结局 */
  readonly outcome?: JobOutcome;
}

const isOutcome = (status: string): status is JobOutcome => status in JOB_OUTCOME_LABELS;

/** 履历：按游戏时间从早到晚；同一时间的委托排在叙事模型写的那段前面 */
export function chronicleEntries(input: {
  readonly chronicle: ChronicleState;
  readonly jobs: readonly Job[];
  /** 角色死了时不为 null */
  readonly death: { readonly at: number; readonly location: string | null } | null;
}): ChronicleEntry[] {
  const order: Readonly<Record<ChronicleKind, number>> = { job: 0, arc: 1, death: 2, ended: 3 };
  const entries: ChronicleEntry[] = [];
  for (const job of input.jobs) {
    if (job.closedAt === null || !isOutcome(job.status)) continue;
    const label = JOB_OUTCOME_LABELS[job.status];
    entries.push({
      at: job.closedAt,
      time: formatGameTime(job.closedAt),
      kind: "job",
      title: job.title,
      text: job.summary ? `${label}：${job.summary}` : label,
      outcome: job.status,
    });
  }
  for (const arc of input.chronicle.arcs) {
    entries.push({
      at: arc.at,
      time: formatGameTime(arc.at),
      kind: "arc",
      title: arc.title,
      text: arc.text,
    });
  }
  if (input.death) {
    entries.push({
      at: input.death.at,
      time: formatGameTime(input.death.at),
      kind: "death",
      title: "死亡",
      text: `死在${input.death.location ?? "夜之城"}`,
    });
  }
  const ended = input.chronicle.ended;
  if (ended) {
    entries.push({
      at: ended.at,
      time: formatGameTime(ended.at),
      kind: "ended",
      title: ENDING_LABELS[ended.how],
      text: ended.epitaph ?? (ended.how === "retired" ? "离开了这一行" : "故事就写到这里"),
    });
  }
  return entries.sort((a, b) => a.at - b.at || order[a.kind] - order[b.kind]);
}

/**
 * 名册的卡面：按角色最高的一项属性挑一张原作塔罗牌（本作改编；原作的塔罗牌是收集品，不对应属性）。
 * 一样高时按肉体、反应、技术、智力、镇定的顺序取前面的
 */
export const TAROT_BY_ATTRIBUTE = {
  body: "strength",
  reflexes: "chariot",
  tech: "magician",
  intelligence: "highpriestess",
  cool: "moon",
} as const satisfies Readonly<Record<Attribute, string>>;
export type TarotCard = (typeof TAROT_BY_ATTRIBUTE)[Attribute];
export const TAROT_LABELS: Readonly<Record<TarotCard, string>> = {
  strength: "力量",
  chariot: "战车",
  magician: "魔术师",
  highpriestess: "女祭司",
  moon: "月亮",
};

export function tarotOf(attributes: Readonly<Record<Attribute, number>>): TarotCard {
  let best: Attribute = "body";
  for (const a of Object.keys(ATTRIBUTE_LABELS) as Attribute[]) {
    if (attributes[a] > attributes[best]) best = a;
  }
  return TAROT_BY_ATTRIBUTE[best];
}

/** 名册里最多给几段履历 */
export const LEGEND_ARCS = 6;

/** 传说名册里的一个人；saveId 由服务端补 */
export interface Legend {
  readonly name: string;
  readonly brief: string | null;
  readonly ending: Ending;
  readonly endingLabel: string;
  /** 离开故事的游戏时间 */
  readonly at: number;
  readonly when: string;
  /** 在夜之城过了几天（从开场算） */
  readonly days: number;
  readonly streetCred: number;
  readonly credTier: string;
  readonly difficulty: string;
  readonly epitaph: string | null;
  readonly card: TarotCard;
  readonly cardLabel: string;
  /** 干净或带瑕疵完成的委托数 */
  readonly jobsDone: number;
  /** 履历：叙事模型写的段落和死亡、结束那一条，最近的几段 */
  readonly chronicle: readonly ChronicleEntry[];
}

/** 进名册的条件：死了且不能再重来，或者玩家结束了故事；还在故事里时是 null */
export function legendOf(view: PlayerView, now: number, startTime: number): Legend | null {
  const dead = view.death !== null && !view.death.canRestart;
  if (!dead && !view.ended) return null;
  const ending: Ending = dead ? "dead" : (view.ended?.how ?? "ended");
  const kept = view.chronicle.filter((e) => e.kind !== "job");
  return {
    name: view.character.name ?? "无名之辈",
    brief: briefLine(view.character.brief ?? null),
    ending,
    endingLabel: ENDING_LABELS[ending],
    at: now,
    when: formatGameTime(now),
    days: Math.max(0, Math.floor((now - startTime) / 1440)),
    streetCred: view.character.streetCred,
    credTier: view.character.credTier,
    difficulty: view.difficulty,
    epitaph: view.ended?.epitaph ?? null,
    card: tarotOf(view.character.attributes),
    cardLabel: TAROT_LABELS[tarotOf(view.character.attributes)],
    jobsDone: view.chronicle.filter((e) => e.outcome === "clean" || e.outcome === "flawed").length,
    chronicle: kept.slice(-LEGEND_ARCS),
  };
}

/** 名册里的简介只要角色卡简介的第一行，最多 60 字 */
const BRIEF_CHARS = 60;
function briefLine(brief: string | null): string | null {
  const first = brief
    ?.split("\n")
    .find((l) => l.trim() !== "")
    ?.trim();
  if (!first) return null;
  return first.length > BRIEF_CHARS ? `${first.slice(0, BRIEF_CHARS - 1)}…` : first;
}

/** 新角色开局时交给叙事模型的一行：名字、结局、时间和一句话，200 字以内；超长时先截掉排在后面的 */
export function legendNote(legend: Legend): LegendNote {
  const last = [...legend.chronicle].reverse().find((e) => e.kind === "arc");
  const stay = legend.days === 0 ? "不到一天" : `${legend.days} 天`;
  const parts = [
    `${legend.credTier}，在夜之城待了${stay}`,
    legend.epitaph ? `留下的话：${legend.epitaph}` : undefined,
    last ? `最后记下的一段「${last.title}」：${last.text}` : undefined,
    legend.brief ?? undefined,
  ].filter((p): p is string => p !== undefined);
  const line = parts.join("；").replace(/\s+/g, " ");
  return {
    name: legend.name.slice(0, 40),
    ending: legend.ending,
    when: legend.when,
    line: line.length > 200 ? `${line.slice(0, 199)}…` : line,
  };
}

/** 开局时带进来的名册：最近进名册的在前，最多 LEGENDS_SEEDED 个 */
export function legendNotes(legends: readonly Legend[]): LegendNote[] {
  return [...legends]
    .sort((a, b) => b.at - a.at)
    .slice(0, LEGENDS_SEEDED)
    .map(legendNote);
}
