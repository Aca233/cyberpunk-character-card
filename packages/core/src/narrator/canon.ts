import { type CanonNode, CanonTimelineSchema } from "../schemas/lore";

const DAY = 24 * 60;
/** 过去了的节点还在提示词里留几天：后续的新闻和传言还在传 */
export const CANON_PAST_DAYS = 3;

/** 从开场算的第几天，开场当天是 0 */
export function canonDay(start: number, now: number): number {
  return Math.floor((now - start) / DAY);
}

/** 这一天要带的节点：正在发生、明天开始、结束不到 CANON_PAST_DAYS 天的 */
export function activeCanon<T extends Pick<CanonNode, "fromDay" | "toDay">>(
  nodes: readonly T[],
  day: number,
): T[] {
  return nodes.filter((n) => n.fromDay <= day + 1 && n.toDay >= day - CANON_PAST_DAYS);
}

const RULES = `这是原剧《赛博朋克：边缘行者》里同时在城里发生的事。玩家没插手时照原剧发生；玩家撞上、插手了，就按玩家做的改，不用拉回原剧。
- 「公开」是街上能听到的，可以借 N54 新闻、电台、传言、一条消息透出来；和【城里的动静】合起来一轮最多透一件，不必每轮都提。
- 「幕后」只有你知道；玩家角色没亲眼看到、没人告诉之前不算知道。
- 「交集」是玩家可能撞上的机会：玩家在合适的地点和时间时让它自然出现，不要硬拉玩家去，不要在选项里点明。
- 还没到的集不写，后面的结局不剧透；战斗和闪回里不提。`;

/** 给模型看的【原剧时间线】；没有时间线或没有开场时间时为 undefined */
export function canonSection(
  data: Readonly<Record<string, unknown>> | undefined,
  start: number | undefined,
  now: number,
): string | undefined {
  if (data?.canon === undefined || start === undefined) return undefined;
  const day = canonDay(start, now);
  if (day < 0) return undefined;
  const live = activeCanon(CanonTimelineSchema.parse(data.canon), day);
  if (live.length === 0) return undefined;
  const when = (n: { fromDay: number; toDay: number }) =>
    day < n.fromDay ? "明天" : day > n.toDay ? `过去了 ${day - n.toDay} 天` : "正在发生";
  const lines = live.map((n) =>
    [
      `- 第 ${n.episode} 集「${n.title}」［${n.id}，${when(n)}，${n.where}］`,
      `  公开：${n.public}`,
      `  幕后：${n.hidden}`,
      `  交集：${n.hooks.join("；")}`,
    ].join("\n"),
  );
  return `${RULES}\n今天是开场后第 ${day} 天。\n${lines.join("\n")}`;
}
