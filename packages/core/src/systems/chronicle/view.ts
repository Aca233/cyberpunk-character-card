import type { ViewContext } from "../../kernel/system";
import { HealthStateSchema } from "../health";
import { JOB_OUTCOME_LABELS, type Job, type JobOutcome, JobsStateSchema } from "../jobs";
import { formatGameTime, WorldClockStateSchema } from "../world";
import { type ChronicleState, ChronicleStateSchema, ENDING_LABELS } from "./schema";

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

/** 玩家结束了故事（退休或停在这里）；没结束是 null。和死透了一样，之后存档只读 */
export function endedView({ world }: ViewContext) {
  // 旧存档没有履历系统
  const state = ChronicleStateSchema.parse(world.slices.chronicle ?? {});
  return (
    state.ended && {
      how: state.ended.how,
      label: ENDING_LABELS[state.ended.how],
      epitaph: state.ended.epitaph,
      at: formatGameTime(state.ended.at),
    }
  );
}

/** 履历：叙事模型写的段落、结束的委托、死亡和结束故事，按游戏时间从早到晚 */
export function chronicleView({ world }: ViewContext) {
  // 旧存档没有履历系统
  const state = ChronicleStateSchema.parse(world.slices.chronicle ?? {});
  const jobs = JobsStateSchema.parse(world.slices.jobs);
  const health = HealthStateSchema.parse(world.slices.health);
  const clock = WorldClockStateSchema.parse(world.slices.world);
  return chronicleEntries({
    chronicle: state,
    jobs: jobs.jobs,
    death: health.condition === "dead" ? { at: world.time, location: clock.location } : null,
  });
}
