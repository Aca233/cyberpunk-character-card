import type { RuleModule } from "../../kernel/system";
import { formatGameTime } from "../world";
import { type FixerCard, fixerBlocked, isOpen, JOB_STATUS_LABELS } from "./apply";
import { JOB_KIND_LABELS, type Job, type JobsState, JobTemplateCatalogSchema } from "./schema";

/** 已结束的委托最多列这么多单，最近的优先 */
export const CLOSED_LISTED = 5;

/** 给模型的定性委托分量描述（不泄漏游戏星级字眼） */
export const JOB_RISK_LABELS: Readonly<Record<number, string>> = {
  1: "跑腿零活",
  2: "街头常规单",
  3: "高危硬单",
  4: "公司/精锐硬仗",
  5: "玩命死活",
};

function trustNote(affinity: number): string {
  if (affinity >= 40) return "过命交情、极信得过";
  if (affinity >= 15) return "关系熟络、比较信任";
  if (affinity >= 0) return "一般交道";
  if (affinity >= -25) return "心存防备";
  return "积怨已深";
}

export const jobsRules: RuleModule<JobsState> = {
  id: "jobs",
  title: "委托",
  commands: ["jobOffer", "jobAccept", "jobNote", "jobEnd"],
  when: () => true,
  judge: `- 没有强制的阶段：踩点、找情报、谈判、换路线、放弃、背叛雇主都按意图处理。准备充分、计划聪明就真的能绕开硬碰硬、把局势拆开解决。
- 委托里的危险与对手火力，按委托分量、雇主/目标势力与现场物理准备实际裁决。
- 中间人只会派他眼下信得过玩家接的活（【委托】里写着各人的口风）。
- 【待接候选与多单并存】：中间人或熟人已经提出但尚未接下的「待接」委托也是世界里的真实约定。玩家完全可以要求中间人再给一个活作比较或一并接下；给出第二单绝不会覆盖、抹掉或令中间人忘记第一单，也允许玩家在未点接单前就继续打听、挑着接或全接。`,
  narrate: `- 委托只是人物间的一种约定，世界还有工作、生活、关系和玩家自发目标，不必把每次互动变成接单。隐藏的转折只有你知道，到合适的时候在正文里揭开，不直接说给玩家。
- 【牢记所有待接与进行中委托】：【委托】里「待接（候选）」和「进行中」的每一单都是人物实际提过、真实存在的活。如果同一中间人先后给出了多个单子（例如玩家让对方再给一个活选），中间人必须清楚记得自己之前提过的每一单，绝不能给出第二单后就把第一单当没说过、吞掉或凭空作废；除非中间人当场明确说明“只能二选一，另一个我立刻转给别人”，否则两单都可以保留供玩家挑选或陆续接手。
- 新单子由人物在正文里给出：中间人打电话、熟人求助、仇家找上门；还没到托付硬单的分量时，就让中间人干脆地说“这活还轮不到你扛”。
- 中间人派的或熟人托的活都在私信或正文对话里自然提出；玩家口头或回消息答应下来才算接下，没有“委托板”这种东西。
- 这单了结时正文写清结局和到手多少；讨价还价、被克扣、顺手多拿都要说得通。
- 失败和坏选择要有真实的后果；被放走的人、被得罪的雇主以后可能回来。`,
  text: `- 委托只是人物间的一种约定，世界还有工作、生活、关系和玩家自发目标，不必把每次互动变成接单。【委托】里列着待接候选与进行中的单子、中间人和他们眼下对玩家角色的交情与口风；隐藏的转折只有你知道，到合适的时候在正文里揭开，不直接说给玩家。
- 【重要 · 提议即入账，多单并存】：只要人物在正文里明确提出了一单具体委托（即便玩家本轮还没答应接、只是先听着或让对方再多给一个单子挑选），就必须立刻发 jobOffer 入账为「待接」，绝不能因为玩家还没答应就放进 dropped 不记！同一中间人允许同时挂出多单待接委托，每单必须用彼此不同的 id（不要复用旧 id）；给第二单时严禁对第一单发 jobEnd(abandoned)，除非正文里玩家或中间人确实明确取消/转包了第一单。
- 玩家角色在正文里答应接下某单时再写 jobAccept（若正文里提议并当场答应，同一轮先写 jobOffer 再写 jobAccept）；中间人只派符合他当前信任分寸的活，分量过重的活就让他直接拒绝。
- 中间人不只【委托】里列的这几位：有人物卡的人都能当中间人派单，jobOffer 的 fixer 写他的 id，代码第一次派单时登记。剧情里冒出新的中间人，同一轮先写 npc 给他建卡（role 写清是哪一带的中间人），再写 jobOffer；根据现实利益、引荐、履历和眼前需求决定是否托付，不能用好感或声望等级锁定。
- 没有强制的阶段：踩点、找情报、谈判、换路线、放弃、背叛雇主都按意图处理。准备充分、计划聪明就真的能把风险拆解掉。
- 玩家在私信或对话里答应接单时写 jobAccept 才算接下；如果玩家在正文里直接明确拒绝某单待接委托，可写 jobEnd(outcome: "abandoned") 了结它；如果玩家没点接单就直接去把待接委托办完了，也可写 jobAccept 或直接 jobEnd 结算。
- 有实质进展、玩家选了某条路、转折被揭开时写 jobNote（待接与进行中委托都可以写）。
- 这单在正文里了结时写 jobEnd，结局按实际发生的事定。paid 只写已经实际到手的钱，没有到款写 0；完成约定不会自动发钱、声望或好感，关系变化需要独立事实。讨价还价、被克扣、顺手多拿都写进 paid，要在正文里说得通；到手的钱由代码记账。
- 失败和坏选择要有真实的后果，但不写脱离局势的空降惩罚；被放走的人、被得罪的雇主以后可能回来。`,
};

function jobLine(job: Job, state: JobsState): string {
  const fixer = job.fixer === null ? undefined : state.fixers[job.fixer];
  const parts = [
    JOB_STATUS_LABELS[job.status],
    ...(job.kind ? [JOB_KIND_LABELS[job.kind]] : []),
    JOB_RISK_LABELS[job.risk] ?? `风险 ${job.risk}`,
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

interface FixerTemperamentEntry {
  readonly id: string;
  readonly preferredStyle: string;
  readonly taboo: string;
}

const FIXER_TEMPERAMENT_ALIASES: Readonly<Record<string, string>> = {
  "mr-hands": "hands",
};

function temperamentOf(
  id: string,
  list: readonly FixerTemperamentEntry[] | undefined,
): FixerTemperamentEntry | undefined {
  if (!list || list.length === 0) return undefined;
  const canonical = FIXER_TEMPERAMENT_ALIASES[id] ?? id;
  return list.find((t) => t.id === id || t.id === canonical);
}

/** 给模型看的【委托】：中间人（含办事风格与忌讳）、挂着和接下的单子，加最近结束的几单 */
export function jobsSection(
  state: JobsState,
  _streetCred: number,
  affinityOf: (id: string) => number,
  /** 派单人所属势力的态度；不传时不算 */
  sideOf: (id: string) => FixerCard["faction"] = () => undefined,
  /** 中间人脾气与偏好表（data.fixerTemperaments） */
  temperaments?: readonly FixerTemperamentEntry[],
): string | undefined {
  const fixers = Object.values(state.fixers);
  if (fixers.length === 0 && state.jobs.length === 0) return undefined;
  const lines = fixers.map((f) => {
    const affinity = affinityOf(f.id);
    const side = sideOf(f.id);
    const temp = temperamentOf(f.id, temperaments);
    const tempNote = temp ? `；风格：${temp.preferredStyle}；忌讳：${temp.taboo}` : "";
    if (side !== undefined && fixerBlocked(side.attitude)) {
      return `- 中间人 ${f.name}［${f.id}］：${trustNote(affinity)}，是${side.name}的人，${side.name}和玩家结了仇，现在不派单${tempNote}`;
    }
    const friendly = side && (side.attitude === "friendly" || side.attitude === "family");
    return `- 中间人 ${f.name}［${f.id}］：${trustNote(affinity)}${friendly ? `（所属${side.name}待玩家友善）` : ""}${tempNote}`;
  });
  const activeJobs = state.jobs.filter((j) => j.status === "active");
  const offeredJobs = state.jobs.filter((j) => j.status === "offered");
  if (activeJobs.length === 0 && offeredJobs.length === 0) {
    lines.push("- 眼下没有挂着或接下的委托");
  } else {
    if (activeJobs.length > 0) {
      lines.push("【进行中的委托】");
      lines.push(...activeJobs.map((j) => jobLine(j, state)));
    }
    if (offeredJobs.length > 0) {
      lines.push(
        "【已提出、待玩家决定是否接下的委托（均真实有效、可并存挑选，未取消前不会消失）】",
      );
      lines.push(...offeredJobs.map((j) => jobLine(j, state)));
    }
  }
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
      `- ${t.kind} ${JOB_KIND_LABELS[t.kind]}：交火 ${t.moments}；潜入 ${t.stealth}；摊牌 ${t.standoff}；典型败局 ${t.defeat}${t.twists.length > 0 ? `；适合的转折 ${t.twists.join("、")}` : ""}`,
  );
  return `【委托类型模板】\n挂委托时 jobOffer 写 kind；按类型取会在哪里交火、潜入和摊牌的位置、典型败局和转折，可以改写或组合，不强制套用。摊牌只是正文里的僵持和谈判，没有专门的指令，真动手了才发 combat start。\n${lines.join("\n")}`;
}
