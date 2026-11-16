/** 只有提供方明确报告自然结束，回复才能进入状态结算。 */
export function completeFinish(reason: string): boolean {
  return reason === "stop" || reason === "STOP" || reason === "end_turn";
}
