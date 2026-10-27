import type { SystemSection } from "../../kernel/system";
import type { WorldState } from "../../kernel/world";
import { CharacterStateSchema } from "../character";
import { NpcStateSchema } from "../npc";
import { formatGameTime, WorldClockStateSchema } from "../world";
import { jobsSection } from "./prompt";
import { JobsStateSchema } from "./schema";

export interface DueEvent {
  readonly kind: "deadline" | "job";
  readonly id: string;
  readonly label: string;
  readonly due: number;
}

/** 已经到期、叙事模型还没回应的事：期限和超期的委托；一次跳过好几天时期间到期的一起列出 */
export function dueEvents(world: WorldState): DueEvent[] {
  const clock = WorldClockStateSchema.parse(world.slices.world);
  const jobs = JobsStateSchema.parse(world.slices.jobs);
  const events: DueEvent[] = [
    ...clock.deadlines
      .filter((d) => d.handledAt === null && d.due <= world.time)
      .map((d) => ({ kind: "deadline" as const, id: d.id, label: d.label, due: d.due })),
    ...jobs.jobs.flatMap((j) =>
      j.status === "active" && j.overdue && !j.dueHandled && j.due !== null
        ? [{ kind: "job" as const, id: j.id, label: j.title, due: j.due }]
        : [],
    ),
  ];
  return events.sort((a, b) => a.due - b.due);
}

function elapsed(minutes: number): string {
  if (minutes < 60) return `${minutes} 分钟`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时`;
  return `${Math.floor(minutes / 1440)} 天`;
}

/** 给模型看的【到期事件】：这一轮必须回应 */
export function dueSection(world: WorldState): string | undefined {
  const due = dueEvents(world);
  if (due.length === 0) return undefined;
  return [
    "这些事已经到期，这一轮必须在正文里回应：人物打来电话、找上门，或者事情就这么黄了，怎么写由你决定。回应后期限写 deadline handle；委托还要接着办就写 jobNote，黄了就写 jobEnd。",
    ...due.map(
      (e) =>
        `- ${e.kind === "job" ? "委托" : "期限"} ${e.label}［${e.id}］：${formatGameTime(e.due)} 到期，已经过了 ${elapsed(world.time - e.due)}`,
    ),
  ].join("\n");
}

/** 给叙事模型的情境节：【委托】跟在【人物】后面，【到期事件】跟在【近期后果】后面 */
export const jobsSections: readonly SystemSection[] = [
  {
    order: 20,
    title: "委托",
    render: ({ world }) => {
      const npcs = NpcStateSchema.parse(world.slices.npc).npcs;
      return jobsSection(
        JobsStateSchema.parse(world.slices.jobs),
        CharacterStateSchema.parse(world.slices.character).streetCred,
        (id) => npcs[id]?.affinity ?? 0,
      );
    },
  },
  { order: 70, title: "到期事件", render: ({ world }) => dueSection(world) },
];
