import type { RuleModule } from "../../kernel/system";
import type { HeatState } from "./schema";

export const eventRules: RuleModule<HeatState> = {
  id: "events",
  title: "事件",
  commands: ["event"],
  when: () => true,
  text: `- 角色杀人、公开动手、偷东西、砸东西时写一条 event，只报告发生了什么：kind、看见的人数 witnesses、是不是在公开场合 public；有人报了警加 reportedTo: "ncpd"。警方热度由代码推导，不要自己算。
- 没人看见、也没被摄像头拍到时 witnesses 写 0、public 写 false；事后有人报警再补一条带 reportedTo 的 event。`,
};

export const heatRules: RuleModule<HeatState> = {
  id: "heat",
  title: "警方热度",
  commands: ["heat"],
  when: (state) => state.stars >= 1,
  text: `- 【当前状态】里的「警方热度」：1–2 星巡警留意，路上可能被拦下盘查；3–4 星 NCPD 主动追捕，盘查变多，常去的地方有人蹲守；5 星且有公开的严重暴力时 MaxTac 出动。热度高时安排盘查和追捕，让玩家在“干票大的”和“先躲一阵”之间取舍。
- 贿赂警察谈成了写 heat bribe，价钱由代码按星级扣（5 星不能贿赂）；被摄像头或盘查看见、但没犯新事写 heat seen。热度会随时间自己降，换个城区也降得快些，不用你写。
- 被捕时：1–2 星罚款（写 money，付不起就加一个还钱的期限）；3–4 星要关几天，装备被没收，正文里事先说清楚。`,
};
