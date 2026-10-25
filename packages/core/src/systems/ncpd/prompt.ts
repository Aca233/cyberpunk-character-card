import type { RuleModule } from "../../kernel/system";
import type { NcpdState } from "./schema";

const WORDS = /警情|NCPD|扫描器|赏金|报警|条子|警察/i;

export const ncpdRules: RuleModule<NcpdState> = {
  id: "ncpd",
  title: "NCPD 警情",
  commands: ["ncpd"],
  when: (state, input) => input.mode !== "ooc" && state.alerts.length > 0 && WORDS.test(input.text),
  narrate: `- 警情是扫描器上挂着的街头案子：到了现场照现场的情况写，帮派、劫匪、人质都有自己的打算；NCPD 往往来得晚，来了也可能嫌你多事。`,
  text: `- 【当前状态】里的「NCPD 警情」是代码挂出来的街头案子，玩家可以去处理，也可以不管（过一天自己撤掉）。
- 玩家到了现场把事办完（本轮检定没失败）写 ncpd clear，id 写警情 id：代码发赏金、警方热度降一星，你不写 trade 也不写 heat。搞砸了或者放弃了写 ncpd drop。
- 处理时动手照常写 event（公开动手、杀人），热度照常涨；办完再降一星。`,
};
