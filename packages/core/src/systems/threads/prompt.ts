import type { RuleModule, SectionContext, SystemSection } from "../../kernel/system";
import { CITY_STATUS_LABELS } from "../city";
import { NpcStateSchema, onStage } from "../npc";
import { formatGameTime, locationCatalog, WorldClockStateSchema } from "../world";
import { THREAD_KIND_LABELS, type Thread, type ThreadsState, ThreadsStateSchema } from "./schema";

/** 高相关现场风声最多展示几条，避免后台全城账本挤占正文注意力 */
const LOCAL_FOCUS_MAX = 3;

export const threadRules: RuleModule<ThreadsState> = {
  id: "threads",
  title: "城中局势与暗流",
  commands: ["thread", "threadTold"],
  when: (state, input) => input.mode !== "ooc" && state.threads.length + state.closed.length > 0,
  judge: `- 【眼前与本区实时风声】和【城中远方脉动】是城中正在发酵的局势；若玩家行动撞上或主动介入其中某件事，按现场人物、阻力与利害裁决玩家能否推动、拖延或破坏它。`,
  narrate: `- 【眼前与本区实时风声】与【城中远方脉动】是城里背地里在推进的事实。走向与结局由场外演化决定，正文不私自代推未发生的结果。
- 标着「玩家尚未听说」的进展，只有借新闻、电台、街头传闻、中间人、熟人或现场撞见透出来才算玩家知道；一轮最多透一件，战斗、潜入与闪回中不硬塞。
- 玩家走进相关城区或碰上相关人物时，可自然露出局势迹象与插手机会；没传到玩家耳中的幕后真相不写成玩家已知。`,
  text: `- 正文里让玩家听说了某件局势的新进展（新闻、传闻、消息、有人亲口说或现场撞见），写 threadTold，id 写那件事的 id；只听到模糊风声、说不清哪件的不算。
- 玩家亲手插手了才写 thread：帮它办成关键一步写 push（马上到点）；拖住它（毁货、抓人、报信）写 stall；彻底搅黄它（干掉主事者、端据点、证据交对头）写 derail，此事收场。reason 一句话写玩家做了什么。只是听说、议论不算插手。`,
};

function stepLine(t: Thread): string {
  const recent = t.steps.slice(-2).map((s) => {
    const who = s.kind === "move" ? "" : "玩家插手：";
    return `${formatGameTime(s.at)} ${who}${s.text}（${s.told ? "玩家已知" : "玩家尚未听说"}）`;
  });
  return recent.length > 0 ? `｜最近：${recent.join("；")}` : "｜刚起头，尚无公开进展";
}

function metaTag(t: Thread): string {
  const parts = [
    t.district ?? "全城",
    CITY_STATUS_LABELS[t.status],
    ...(t.weight === "major" ? ["头条"] : []),
  ];
  return `［${parts.join("，")}］`;
}

function detailedLine(t: Thread): string {
  return `- ${t.id}｜${THREAD_KIND_LABELS[t.kind]}·${t.title}${metaTag(t)}：想要${t.want}｜眼下：${t.stage}${stepLine(t)}`;
}

function compactLine(t: Thread): string {
  const latest = t.steps.at(-1);
  const tail = latest ? `${latest.news}（${latest.told ? "玩家已知" : "玩家尚未听说"}）` : t.stage;
  return `- ${t.id}｜${THREAD_KIND_LABELS[t.kind]}·${t.title}${metaTag(t)}：${tail}`;
}

function relevanceScore(
  t: Thread,
  district: string | undefined,
  stageNpcs: ReadonlySet<string>,
  stageTies: ReadonlySet<string>,
  stageFactions: ReadonlySet<string>,
): number {
  let score = 0;
  if (t.owner !== null) {
    if (stageNpcs.has(t.owner)) score += 6;
    else if (stageTies.has(t.owner) || stageFactions.has(t.owner)) score += 4;
  }
  if (district !== undefined && t.district === district) score += 3;
  if (t.weight === "major") {
    score += t.steps.some((s) => !s.told) || t.steps.length === 0 ? 3 : 2;
  }
  if (t.status === "heating") score += 1;
  return score;
}

function partitionThreads(ctx: SectionContext): {
  readonly focus: readonly Thread[];
  readonly distant: readonly Thread[];
  readonly closed: ThreadsState["closed"];
} {
  const state = ThreadsStateSchema.parse(ctx.world.slices.threads ?? {});
  if (state.threads.length === 0) {
    return { focus: [], distant: [], closed: state.closed };
  }
  const clock = WorldClockStateSchema.parse(ctx.world.slices.world);
  const district =
    clock.location !== null && ctx.data
      ? locationCatalog(ctx.data).get(clock.location)?.district
      : undefined;
  const roster = NpcStateSchema.parse(ctx.world.slices.npc ?? {}).npcs;
  const stage = { location: clock.location, sceneStartedAt: clock.sceneStartedAt };
  const stageNpcs = new Set<string>();
  const stageTies = new Set<string>();
  const stageFactions = new Set<string>();
  for (const n of Object.values(roster)) {
    if (!onStage(n, stage)) continue;
    stageNpcs.add(n.id);
    if (n.faction) stageFactions.add(n.faction);
    for (const tie of n.ties) stageTies.add(tie.id);
  }
  const scored = state.threads.map((t) => ({
    t,
    score: relevanceScore(t, district, stageNpcs, stageTies, stageFactions),
    updated: t.updatedAt ?? t.openedAt,
  }));
  scored.sort((a, b) => b.score - a.score || b.updated - a.updated);
  const focus = scored
    .filter((item) => item.score > 0)
    .slice(0, LOCAL_FOCUS_MAX)
    .map((item) => item.t);
  const focusIds = new Set(focus.map((t) => t.id));
  const distant = scored.filter((item) => !focusIds.has(item.t.id)).map((item) => item.t);
  return { focus, distant, closed: state.closed };
}

/** 兼容直接调用：返回完整城中局势文本 */
export function threadSection(state: ThreadsState): string | undefined {
  const lines = state.threads.map(detailedLine);
  for (const t of state.closed.slice(-3)) {
    lines.push(`- ${t.id}｜已收场·${t.title}：${t.end}`);
  }
  return lines.length > 0 ? lines.join("\n") : undefined;
}

/** 导演桥接层情境节：按现场相关性拆分为【眼前与本区实时风声】与【城中远方脉动】 */
export const threadSections: readonly SystemSection[] = [
  {
    order: 110,
    title: "眼前与本区实时风声",
    stages: ["judge", "narrate"],
    render: (ctx) => {
      const { focus } = partitionThreads(ctx);
      if (focus.length === 0) return undefined;
      return focus.map(detailedLine).join("\n");
    },
  },
  {
    order: 110.5,
    title: "城中远方脉动",
    render: (ctx) => {
      const state = ThreadsStateSchema.parse(ctx.world.slices.threads ?? {});
      if (ctx.stage === "extract") {
        // 抽取阶段给全部活跃与近期收场局势的精简索引，便于核对 thread / threadTold id
        const lines = [
          ...state.threads.map(compactLine),
          ...state.closed.slice(-3).map((t) => `- ${t.id}｜已收场·${t.title}：${t.end}`),
        ];
        return lines.length > 0 ? lines.join("\n") : undefined;
      }
      const { distant, closed } = partitionThreads(ctx);
      const lines = [
        ...distant.map(compactLine),
        ...closed.slice(-3).map((t) => `- ${t.id}｜已收场·${t.title}：${t.end}`),
      ];
      return lines.length > 0 ? lines.join("\n") : undefined;
    },
  },
];
