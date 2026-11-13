import type { RuleModule } from "../../kernel/system";
import type { HeatState } from "./schema";

export const eventRules: RuleModule<HeatState> = {
  id: "events",
  title: "事件",
  commands: ["event"],
  when: () => true,
  judge: `- 杀人、公开动手、偷东西、砸东西会被看见、被报警：判断风险时把目击者和摄像头算进去；警方热度由代码推导，不用你算。`,
  narrate: `- 杀人、公开动手、偷东西、砸东西时，正文写清有没有人看见、是不是在公开场合、有没有人报了警；没人看见就写没人看见。`,
  text: `- 角色杀人、公开动手、偷东西、砸东西时写一条 event，只报告发生了什么：kind、看见的人数 witnesses、是不是在公开场合 public；有人报了警加 reportedTo: "ncpd"。警方热度由代码推导，不要自己算。
- 没人看见、也没被摄像头拍到时 witnesses 写 0、public 写 false；事后有人报警再补一条带 reportedTo 的 event。`,
};

export const heatRules: RuleModule<HeatState> = {
  id: "heat",
  title: "警方热度",
  commands: ["heat", "bounty"],
  when: (state) => state.stars >= 1 || (state.bounties ?? []).some((b) => b.resolvedAt === null),
  judge: `- 贿赂警察照现场谈判、对方胃口与局势处理；价钱由代码按热度扣，最高通缉（5 星，暴恐机动队级别）不能贿赂。
- 热度高时被盘查、封路或追上的物理风险要诚实裁定；被捕的后果（低热度罚款，高热度拘留几天、没收随身武器或被找上门）按实际警力反应兑现。`,
  narrate: `- 【当前状态】里的「警方热度」：1–2 星巡警留意，路上可能被拦下盘查；3–4 星 NCPD 主动追捕，盘查变多，常去的地方有人蹲守；5 星且有公开的严重暴力时 MaxTac 出动。
- 热度高时安排盘查和追捕，让玩家在“干票大的”和“先躲一阵”之间取舍；热度会随时间自己降，换个城区、在自己的安全屋里躲上大半天也降得快些。`,
  text: `- 【当前状态】里的「警方热度」：1–2 星巡警留意，路上可能被拦下盘查；3–4 星 NCPD 主动追捕，盘查变多，常去的地方有人蹲守；5 星且有公开的严重暴力时 MaxTac 出动。热度高时安排盘查和追捕，让玩家在“干票大的”和“先躲一阵”之间取舍。
- 贿赂警察谈成了写 heat bribe，价钱由代码按星级扣（5 星不能贿赂）；被摄像头或盘查看见、但没犯新事写 heat seen。热度会随时间自己降，换个城区、在自己的安全屋里一口气躲满 6 小时也多降一星，都由代码算，不用你写。
- 被捕时：1–2 星罚款（写 trade service fine，付不起就加一个还钱的期限）；3–4 星要关几天，装备被没收，正文里事先说清楚。
- 悬赏：4 星以上的暴力大案由代码挂悬赏，不随时间消失，改记录、贿赂都消不掉。【当前状态】里有悬赏而还没有赏金猎人时，在合适的场景让一名赏金猎人登场：先写 npc 建卡，再写 bounty hunter（npc 写他的 id）；之后他照自己的办法追你。
- 悬赏只能靠剧情了结：摆平（中间人斡旋、付钱）、有人顶罪、伪造死亡、离开城区避一阵；真了结了写 bounty resolve，how 写办法，reason 写凭的是哪件事。`,
};
