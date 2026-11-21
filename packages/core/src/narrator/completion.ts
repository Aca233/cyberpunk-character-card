/** 只有提供方明确报告自然结束，回复才能进入状态结算。 */
export function completeFinish(reason: string): boolean {
  const normalized = reason.trim().toLowerCase();
  return normalized === "stop" || normalized === "end_turn";
}

/** 是否因达到最大输出上限（max_tokens / length）而被截断。 */
export function isLengthFinish(reason: string): boolean {
  const normalized = reason.trim().toLowerCase();
  return normalized === "length" || normalized === "max_tokens";
}
