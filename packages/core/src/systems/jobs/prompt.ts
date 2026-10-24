import type { RuleModule } from "../../kernel/system";
import { formatGameTime } from "../world";
import { isOpen, JOB_STATUS_LABELS, maxRisk } from "./apply";
import { JOB_KIND_LABELS, type Job, type JobsState, JobTemplateCatalogSchema } from "./schema";

/** 已结束的委托最多列这么多单，最近的优先 */
export const CLOSED_LISTED = 5;

export const jobsRules: RuleModule<JobsState> = {
  id: "jobs",
  title: "委托",
  commands: ["jobOffer", "jobAccept", "jobNote", "jobEnd"],
  when: () => true,
  text: `- 委托是故事的燃料。【委托】里列着挂出和接下的单子、中间人和他们对玩家角色的好感；隐藏的转折只有你知道，到合适的时候在正文里揭开，不直接说给玩家。
- 新单子由人物在正文里给出：中间人打电话、熟人求助、仇家找上门。挂出时写 jobOffer，玩家角色在正文里答应了再写 jobAccept；中间人只派他现在肯派的星级，派不出的活就让他说“你还不够格”。
- 没有强制的阶段：踩点、找情报、谈判、换路线、放弃、背叛雇主都按意图处理。准备充分、计划聪明就真的降低风险或免去检定。
- 玩家也能在委托板上直接接单：进展笔记里写着“在委托板上接下”的单子已经算接下，不要再写 jobAccept；找个自然的时机让中间人或雇主联系玩家角色，交代细节。
- 有实质进展、玩家选了某条路、转折被揭开时写 jobNote。
- 这单在正文里了结时写 jobEnd，结局按实际发生的事定。讨价还价、被克扣、顺手多拿都写进 paid，要在正文里说得通；到手的钱由代码记账。
- 失败和坏选择要有真实的后果，但不超过事先说明的范围；被放走的人、被得罪的雇主以后可能回来。`,
};

function jobLine(job: Job, state: JobsState): string {
  const fixer = job.fixer === null ? undefined : state.fixers[job.fixer];
  const parts = [
    JOB_STATUS_LABELS[job.status],
    ...(job.kind ? [JOB_KIND_LABELS[job.kind]] : []),
    `${job.risk} 星`,
    `报酬 ${job.reward} 欧元`,
    fixer ? `中间人 ${fixer.name}［${fixer.id}］` : "没有中间人",
    `雇主 ${job.client}`,
    ...(job.location ? [`地点 ${job.location}`] : []),
    ...(job.due === null
      ? []
      : [`期限 ${formatGameTime(job.due)}${job.overdue ? "（已超期）" : ""}`]),
  ];
  const lines = [`- ${job.title}［${job.id}］${parts.join("，")}`, `  利益冲突：${job.conflict}`];
  if (job.twist) lines.push(`  隐藏的转折：${job.twist}`);
  if (job.notes.length > 0) lines.push(`  进展：${job.notes.join("；")}`);
  return lines.join("\n");
}

/** 给模型看的【委托】：中间人、挂着和接下的单子，加最近结束的几单 */
export function jobsSection(
  state: JobsState,
  streetCred: number,
  affinityOf: (id: string) => number,
): string | undefined {
  const fixers = Object.values(state.fixers);
  if (fixers.length === 0 && state.jobs.length === 0) return undefined;
  const lines = fixers.map(
    (f) =>
      `- 中间人 ${f.name}［${f.id}］：好感 ${affinityOf(f.id)}，现在最多派 ${maxRisk(affinityOf(f.id), streetCred)} 星`,
  );
  const open = state.jobs.filter(isOpen);
  if (open.length === 0) lines.push("- 眼下没有挂着或接下的委托");
  else lines.push(...open.map((j) => jobLine(j, state)));
  for (const j of state.jobs.filter((job) => !isOpen(job)).slice(-CLOSED_LISTED)) {
    lines.push(
      `- 已结束：${j.title}［${j.id}］${JOB_STATUS_LABELS[j.status]}${j.summary ? `——${j.summary}` : ""}`,
    );
  }
  return lines.join("\n");
}

/** 系统提示词里的【委托类型模板】：8 类委托各自的分段结构、潜入和对峙的位置、典型败局和适合的转折 */
export function jobTemplateSection(data: Readonly<Record<string, unknown>>): string | undefined {
  if (data.jobTemplates === undefined) return undefined;
  const list = JobTemplateCatalogSchema.parse(data.jobTemplates);
  if (list.length === 0) return undefined;
  const lines = list.map(
    (t) =>
      `- ${t.kind} ${JOB_KIND_LABELS[t.kind]}：分段 ${t.moments}；潜入 ${t.stealth}；对峙 ${t.standoff}；典型败局 ${t.defeat}${t.twists.length > 0 ? `；适合的转折 ${t.twists.join("、")}` : ""}`,
  );
  return `【委托类型模板】\n挂委托时 jobOffer 写 kind；按类型取分段结构、潜入和对峙的位置、典型败局和转折，可以改写或组合，不强制套用。\n${lines.join("\n")}`;
}
