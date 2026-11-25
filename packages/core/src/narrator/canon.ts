import { type CanonNode, CanonTimelineSchema } from "../schemas/lore";
import { calendarDayDiff } from "../systems/world/apply";

/** 过去了的节点还在提示词里留几天：后续的新闻和传言还在传 */
export const CANON_PAST_DAYS = 3;

/** 从开场算的第几个日历日，开场当天是 0（按 00:00 自然日切换，与时钟「第 X 天」同步） */
export function canonDay(start: number, now: number): number {
  return now < start ? -1 : calendarDayDiff(start, now);
}

/** 这一天要带的节点：正在发生、明天开始、结束不到 CANON_PAST_DAYS 天的 */
export function activeCanon<T extends Pick<CanonNode, "fromDay" | "toDay">>(
  nodes: readonly T[],
  day: number,
): T[] {
  return nodes.filter((n) => n.fromDay <= day + 1 && n.toDay >= day - CANON_PAST_DAYS);
}

const RULES = `这是 2077 年夜之城在背景中同时发酵的大事件脉络。玩家角色不是 V，不强塞主线任务或芯片死线；玩家没插手时城里的风声可顺势演进，一旦玩家插手或本局已有冲突事实（例如关键人物已死、地点或阵营已变），一律以本局事实为准彻底改写，绝不硬拉回原作。
- 「公开」是街上能听到的，可以借 N54 新闻、电台、传言或闲谈透出来；和【城里的动静】合起来一轮最多透一件，不必每轮都提。
- 「幕后」只有你知道；玩家角色没亲眼看到、没人告诉之前不算知道。
- 「交集」是玩家在合适地点和时间可能撞上的机会，自然出现即可，不要硬拉玩家去，不要在选项里点明。
- 还没到的节点不提前剧透，未确立的原作死亡/悲剧结局不预设为必然；战斗和闪回里不提。`;

/** 给模型看的【2077 世界时间线】；有时间线和开场时间时按开场后天数生效 */
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
    day < n.fromDay ? "明天起酝酿" : day > n.toDay ? `过去了 ${day - n.toDay} 天` : "正在发酵";
  const lines = live.map((n) =>
    [
      `- ［${n.phase} · ${n.title}］（${n.id}，${when(n)}，${n.where}）`,
      `  公开：${n.public}`,
      `  幕后：${n.hidden}`,
      `  交集：${n.hooks.join("；")}`,
    ].join("\n"),
  );
  return `${RULES}\n今天是开场第 ${day + 1} 天（已过 ${day} 天）。\n${lines.join("\n")}`;
}
