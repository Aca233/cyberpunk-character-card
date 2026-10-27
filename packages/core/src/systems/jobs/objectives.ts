import type { Objective, ViewContext } from "../../kernel/system";
import { formatGameTime } from "../world";
import { isOpen } from "./apply";
import { JobsStateSchema } from "./schema";

/** 委托交的待办：挂着等接的和在办的；转折只给模型看，不在这里，进度写最近一条进展笔记 */
export function jobsObjectives({ world }: ViewContext): readonly Objective[] {
  const jobs = JobsStateSchema.parse(world.slices.jobs);
  return jobs.jobs.filter(isOpen).map((j) => {
    const overdue = j.status === "active" && j.due !== null && j.due <= world.time;
    return {
      id: `jobs:${j.id}`,
      source: "jobs",
      sourceLabel: "委托",
      title: j.title,
      location: j.location,
      due: j.due === null ? null : formatGameTime(j.due),
      dueIn: j.due === null ? null : j.due - world.time,
      progress: j.notes.at(-1) ?? null,
      status: j.status === "offered" ? "offered" : overdue ? "overdue" : "active",
    };
  });
}
