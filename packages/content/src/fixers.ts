/** 中间人：开档时写进委托系统；好感记在同 id 的人物卡上（npcs.ts） */
export const fixers: readonly {
  readonly id: string;
  readonly name: string;
}[] = [
  // 法拉第在原剧第 10 集死了：只给旧存档和以后的 2075 剧本用
  { id: "faraday", name: "法拉第" },
  { id: "regina", name: "瑞吉娜·琼斯" },
];
