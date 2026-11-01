/**
 * 中间人：开档时写进委托系统；好感记在同 id 的人物卡上（npcs.ts）。
 * 罗格、和歌子、神父、德克斯特是用户定的补进来的（2026-10-30），人物卡的身份本来就是中间人；
 * 旧存档没种这几位时，委托系统在他们第一次派单时按人物卡自动登记（jobs/apply.ts 的 offerJob）
 */
export const fixers: readonly {
  readonly id: string;
  readonly name: string;
}[] = [
  // 法拉第在原剧第 10 集死了：只给旧存档和以后的 2075 剧本用
  { id: "faraday", name: "法拉第" },
  { id: "regina", name: "瑞吉娜·琼斯" },
  { id: "rogue", name: "罗格" },
  { id: "wakako", name: "冈田和歌子" },
  { id: "padre", name: "神父" },
  { id: "dex", name: "德克斯特·德肖恩" },
];
