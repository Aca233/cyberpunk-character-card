import { formatGameTime } from "../world";
import type { MemoryState, SceneSummary } from "./schema";

/** 【前情】带最近几场的摘要，再加更早的关键场；上下文预算在后续切片按 contextWindow 调 */
export const RECAP_RECENT = 12;
export const RECAP_KEY = 6;

/** 给模型看的一条场景摘要 */
export function recapLine(s: SceneSummary): string {
  const key = s.importance === "key" ? "［关键］" : "";
  return `- ${formatGameTime(s.at)}「${s.title}」${key}：${s.text}`;
}

/**
 * 【前情】：已经收场、原文不在这一步里的场景摘要，按场次从旧到新；
 * shown 是这一步带着原文的场次，那几场不再重复
 */
export function recapSection(state: MemoryState, shown: ReadonlySet<number>): string | undefined {
  const eligible = state.scenes.filter((s) => !shown.has(s.scene));
  if (eligible.length === 0) return undefined;
  const recent = eligible.slice(-RECAP_RECENT);
  const older = eligible
    .slice(0, Math.max(0, eligible.length - RECAP_RECENT))
    .filter((s) => s.importance === "key")
    .slice(-RECAP_KEY);
  return [
    "更早几场的摘要：都是已经发生的事，原文不再给；正文和判断要和这些前后一致。",
    ...[...older, ...recent].map(recapLine),
  ].join("\n");
}
