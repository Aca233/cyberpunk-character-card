import { formatGameTime } from "../world";
import type { MemoryState, SceneSummary } from "./schema";

/** 【前情】最多带最近几场的摘要，再加更早的关键场；实际带多少由上下文预算的 recap 一项按 token 截 */
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
export function recapSection(
  state: MemoryState,
  shown: ReadonlySet<number>,
  maxTokens?: number,
): string | undefined {
  const scenes = recapScenes(state, shown, maxTokens);
  if (scenes.length === 0) return undefined;
  return [
    "更早几场的摘要：都是已经发生的事，原文不再给；正文和判断要和这些前后一致。",
    ...scenes.map(recapLine),
  ].join("\n");
}

/** 粗估：一个字算 1 个 token，偏保守（英文和数字算多了） */
function lineTokens(s: SceneSummary): number {
  return [...recapLine(s)].length;
}

/**
 * 【前情】带哪几场：最近 RECAP_RECENT 场，加更早的 RECAP_KEY 个关键场；扩展层按它去重。
 * 给了 maxTokens 时超出就先去掉最旧的非关键场，再去掉最旧的关键场
 */
export function recapScenes(
  state: MemoryState,
  shown: ReadonlySet<number>,
  maxTokens?: number,
): SceneSummary[] {
  const eligible = state.scenes.filter((s) => !shown.has(s.scene));
  const recent = eligible.slice(-RECAP_RECENT);
  const older = eligible
    .slice(0, Math.max(0, eligible.length - RECAP_RECENT))
    .filter((s) => s.importance === "key")
    .slice(-RECAP_KEY);
  const picked = [...older, ...recent];
  if (maxTokens === undefined) return picked;
  let used = picked.reduce((n, s) => n + lineTokens(s), 0);
  while (used > maxTokens && picked.length > 0) {
    const i = picked.findIndex((s) => s.importance !== "key");
    const [gone] = picked.splice(Math.max(i, 0), 1);
    if (gone) used -= lineTokens(gone);
  }
  return picked;
}
