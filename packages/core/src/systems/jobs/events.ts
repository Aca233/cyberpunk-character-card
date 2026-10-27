import type { EventContext, SystemEvent } from "../../kernel/system";
import { JOB_STATUS_LABELS } from "./apply";
import { JobsStateSchema } from "./schema";

/** 委托交的系统通知：新挂出的委托、状态变了的委托；转折只给模型看，不在这里 */
export function jobsEvents({ before, after }: EventContext): readonly SystemEvent[] {
  const was = new Map(JobsStateSchema.parse(before.world.slices.jobs).jobs.map((j) => [j.id, j]));
  const result: SystemEvent[] = [];
  for (const job of JobsStateSchema.parse(after.world.slices.jobs).jobs) {
    const old = was.get(job.id);
    if (!old) {
      result.push({ source: "jobs", icon: "journal", text: `新委托：${job.title}`, tone: "info" });
    } else if (old.status !== job.status) {
      const good = job.status === "active" || job.status === "clean" || job.status === "flawed";
      result.push({
        source: "jobs",
        icon: "questUpdate",
        text: `委托${JOB_STATUS_LABELS[job.status]}：${job.title}`,
        tone: good ? "good" : "bad",
      });
    }
  }
  return result;
}
