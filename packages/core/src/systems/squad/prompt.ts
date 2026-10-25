import type { RuleModule } from "../../kernel/system";
import { SHARE_MAX, SHARE_TOTAL_MAX, SQUAD_MAX, type SquadState } from "./schema";

const WORDS = /小队|队员|入队|招募|跟我干|分成|薪水|工钱/;

export const squadRules: RuleModule<SquadState> = {
  id: "squad",
  title: "小队",
  commands: ["squad"],
  when: (state, input) =>
    input.mode !== "ooc" &&
    (state.members.length > 0 || state.offers.length > 0 || WORDS.test(input.text)),
  narrate: `- 队员是有自己想法的人：玩家在输入里下的调度，队员按专长和性格去做，用自己的属性出手，失败时受伤的是队员；不替玩家角色做决定。好感也是肯不肯跟你干的程度，太低时队员会讨价还价、拒绝或离开。`,
  text: `- 有人物卡、见过面的人在剧情里答应跟玩家干时写 squad offer：kind 写 friend（朋友型，share 写分成百分比，一人最多 ${SHARE_MAX}，合计最多 ${SHARE_TOTAL_MAX}）或 hired（雇佣型，wage 写周薪），specialty 写专长，trouble 写个人麻烦。入队要玩家在小队面板确认，写了 offer 之后正文里不要当成已经入队；最多 ${SQUAD_MAX} 人。
- 委托报酬由代码按分成分给朋友型队员，雇佣型由玩家在面板发薪，都不另写 money。
- 队员受伤、被抓、脱险写 squad status（hurt、captured、ok）；队员自己走写 squad leave。
- 队员只有在确认条事先点名写明这名队员有致命危险、检定又失败时才会死，这时写 squad dead；没有事先警告的，最坏是重伤或被抓。
- 队员会带来跟个人麻烦有关的私人请求和委托。`,
};
