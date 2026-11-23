import type { SystemSection } from "../../kernel/system";
import type { WorldState } from "../../kernel/world";
import { NpcStateSchema } from "../npc";
import { formatGameTime, WorldClockStateSchema } from "../world";
import { jobsSection } from "./prompt";
import { JobsStateSchema } from "./schema";
import { factionSide } from "./side";

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

/** 到期事实持续可查；只有实际发生并可感知的后果才进入当前镜头。 */
export function dueSection(
  world: WorldState,
  stage?: "judge" | "narrate" | "extract",
): string | undefined {
  const due = dueEvents(world);
  if (due.length === 0) return undefined;
  const header =
    stage === "extract"
      ? "这些约定已经到期。实际回应后期限写 deadline handle；委托有后续事实写 jobNote，确已了结才写 jobEnd。"
      : "这些约定已经到期。根据人物日程、通信条件和已发生的事推进后果；玩家可以继续当前行动，不因期限强制让人打电话或找上门，也不把离场信息直接告知玩家。";
  return [
    header,
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
    render: ({ world, data }) => {
      const npcs = NpcStateSchema.parse(world.slices.npc).npcs;
      const temperaments = Array.isArray(data?.fixerTemperaments)
        ? (data.fixerTemperaments as readonly {
            readonly id: string;
            readonly preferredStyle: string;
            readonly taboo: string;
          }[])
        : undefined;
      return jobsSection(
        JobsStateSchema.parse(world.slices.jobs),
        (id) => npcs[id]?.affinity ?? 0,
        // 派单人所属势力的态度（用户 2026-10-31 选的「势力进机制」）：和派单时一样算
        (id) => factionSide(npcs[id]?.faction, data ?? {}, world.slices.factions),
        temperaments,
      );
    },
  },
  {
    order: 70,
    title: "到期事件",
    render: ({ world, stage }) => dueSection(world, stage),
  },
];
