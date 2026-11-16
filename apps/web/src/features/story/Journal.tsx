/** 期限倒计时：还剩几小时几分，过了就是已超期 */
export function countdown(minutes: number): string {
  if (minutes <= 0) return "已超期";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `还剩 ${days} 天 ${hours} 小时`;
  if (hours > 0) return `还剩 ${hours} 小时 ${mins} 分`;
  return `还剩 ${mins} 分`;
}
