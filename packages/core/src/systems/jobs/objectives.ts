import type { Objective, ViewContext } from "../../kernel/system";
import { formatGameTime } from "../world";
import { JobsStateSchema } from "./schema";

/** 委托交的待办：只在正文或消息里确实接下、正在办的单子（尚未答应的不进追踪板）；进度写最近一条进展笔记 */
export function jobsObjectives({ world }: ViewContext): readonly Objective[] {
  const jobs = JobsStateSchema.parse(world.slices.jobs);
  return jobs.jobs
    .filter((j) => j.status === "active")
    .map((j) => {
      const overdue = j.due !== null && j.due <= world.time;
      return {
        id: `jobs:${j.id}`,
        source: "jobs",
        sourceLabel: "委托",
        title: j.title,
        location: j.location,
        due: j.due === null ? null : formatGameTime(j.due),
        dueIn: j.due === null ? null : j.due - world.time,
        progress: j.notes.at(-1) ?? null,
        status: overdue ? "overdue" : "active",
      };
    });
}
