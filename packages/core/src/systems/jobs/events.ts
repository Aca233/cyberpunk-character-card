import type { EventContext, SystemEvent } from "../../kernel/system";
import { JOB_STATUS_LABELS } from "./apply";
import { JobsStateSchema } from "./schema";

/** 委托交的系统通知：正式接下或结局/中止时提示；刚口头或私信提起的活（offered）由对话/消息本身通知，不抢发系统弹窗 */
export function jobsEvents({ before, after }: EventContext): readonly SystemEvent[] {
  const was = new Map(JobsStateSchema.parse(before.world.slices.jobs).jobs.map((j) => [j.id, j]));
  const result: SystemEvent[] = [];
  for (const job of JobsStateSchema.parse(after.world.slices.jobs).jobs) {
    const old = was.get(job.id);
    if (!old) {
      if (job.status === "offered") continue;
      const good = job.status === "active" || job.status === "clean" || job.status === "flawed";
      result.push({
        source: "jobs",
        icon: "questUpdate",
        text:
          job.status === "active"
            ? `已接委托：${job.title}`
            : `委托${JOB_STATUS_LABELS[job.status]}：${job.title}`,
        tone: good ? "good" : "bad",
      });
    } else if (old.status !== job.status) {
      if (old.status === "offered" && job.status === "expired") continue;
      const good = job.status === "active" || job.status === "clean" || job.status === "flawed";
      result.push({
        source: "jobs",
        icon: "questUpdate",
        text:
          job.status === "active"
            ? `已接委托：${job.title}`
            : `委托${JOB_STATUS_LABELS[job.status]}：${job.title}`,
        tone: good ? "good" : "bad",
      });
    } else if ((job.paid ?? 0) > (old.paid ?? 0)) {
      result.push({
        source: "jobs",
        icon: "questUpdate",
        text: `委托到账：${job.title}（${(job.paid ?? 0) - (old.paid ?? 0)} 欧元）`,
        tone: "good",
      });
    }
  }
  return result;
}
