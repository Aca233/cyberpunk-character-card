import type { RuleModule } from "../../kernel/system";
import type { SidegigsState } from "./schema";

const WORDS = /拳赛|拳场|地下拳|擂台|赛车|飙车|街头赛/;

export const sidegigRules: RuleModule<SidegigsState> = {
  id: "sidegigs",
  title: "拳赛和赛车",
  commands: ["sidegig"],
  when: (state, input) => input.mode !== "ooc" && (state.active !== null || WORDS.test(input.text)),
  text: `- 拳赛和赛车：【当前状态】里列着这里能参加的。玩家报名写 sidegig enter（代码扣押金）；比赛胜负按前置物理裁决，不掷骰：拳赛只能空手或用近战义体，拼体格、出拳经验、反应神经义体与现有伤势；赛车看天气、赛道、车况、改装和驾驶反应。赢了写 sidegig win（代码付奖金、加半级声望），输了写 sidegig lose；中途不比了写 quit。
- 不写奖金和押金的 money；打赢过的对手不再比，输了要等一天才肯再比。`,
};
