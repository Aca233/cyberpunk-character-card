import type { RuleModule } from "../../kernel/system";
import type { SidegigsState } from "./schema";

const WORDS = /拳赛|拳场|地下拳|擂台|赛车|飙车|街头赛/;

export const sidegigRules: RuleModule<SidegigsState> = {
  id: "sidegigs",
  title: "拳赛和赛车",
  commands: ["sidegig"],
  when: (state, input) => input.mode !== "ooc" && (state.active !== null || WORDS.test(input.text)),
  judge: `- 拳赛和赛车按实际条件裁决，不掷骰：拳赛只能空手或用近战义体，拼体格、出拳经验、反应神经义体与现有伤势；赛车看天气、赛道、车况、改装和驾驶反应。
- 赛车报名时车辆必须停在赛场、未报废且已选用；偷来的车也能上场，但安防和追索风险照旧存在。打赢过的对手不再比，输了要等一天才肯再比。`,
  narrate: `- 拳赛和赛车是街头实打实的硬拼：拳赛按体格、拳路、反应与现有伤势写出招拆招，赛车按车况、路况与驾驶技术写追逐与弯道博弈；胜负和奖惩以已定结果为准。`,
  text: `- 拳赛和赛车：【当前状态】里列着这里能参加的。玩家报名写 sidegig enter（代码扣押金）；比赛胜负按前置物理裁决，不掷骰。赢了写 sidegig win（代码付奖金、加半级声望），输了写 sidegig lose；中途不比了写 quit。
- 赛车报名时车辆必须停在赛场、未报废且已选用；可以使用偷来的车，但相关安防和追索风险仍然存在。
- 不写奖金和押金的 money；打赢过的对手不再比，输了要等一天才肯再比。`,
};
