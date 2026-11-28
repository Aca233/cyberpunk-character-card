import type { RuleModule } from "../../kernel/system";
import type { NcpdState } from "./schema";

const WORDS = /警情|NCPD|扫描器|赏金|报警|条子|警察/i;

export const ncpdRules: RuleModule<NcpdState> = {
  id: "ncpd",
  title: "NCPD 警情",
  commands: ["ncpd"],
  when: (state, input) => input.mode !== "ooc" && state.alerts.length > 0 && WORDS.test(input.text),
  judge: `- 扫描器上的 NCPD 警情是真实街头案发现场，涉案帮派、劫匪和人质按实际火力、人数与位置裁决；公开开火与杀人照常受目击与通缉因果约束。`,
  narrate: `- 警情是扫描器上挂着的街头案子：到了现场照现场的情况写，帮派、劫匪、人质都有自己的打算；NCPD 往往来得晚，来了也可能嫌你多事。`,
  text: `- 【当前状态】里的「NCPD 警情」是代码挂出来的街头案子，玩家可以去处理，也可以不管（过一天自己撤掉）。
- 玩家到了警情 location 指定的现场把事彻底摆平（交火解围或控场妥善解决）写 ncpd clear，id 写警情 id；只在同一城区或只听到消息不算到场。可以在本轮现场处理完后再离开，必须保留真实移动与处理的因果顺序。代码按通缉星级发赏金（3 星及以上冻结外包赏金）并缓和追查压力；涉帮警情还会自动联动势力（动自家帮派地盘直接记帮规污点、动别家帮派触发态度恶化，累计帮警局摆平 3 起可赢得 NCPD 友好），你不另写 trade、heat 或重复的 faction。搞砸了或者放弃了写 ncpd drop。
- 处理时动手照常写 event（公开动手、杀人），热度照常涨；办完再降一星。`,
};
