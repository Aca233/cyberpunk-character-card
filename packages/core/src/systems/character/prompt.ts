import type { RuleModule } from "../../kernel/system";
import type { CharacterState } from "./schema";

export const streetCredRules: RuleModule<CharacterState> = {
  id: "streetCred",
  title: "街头声望",
  commands: ["streetCred"],
  when: () => true,
  text: `- 街头声望是夜之城对玩家角色的认知：等级越高，中间人肯派的活越大，路人、帮派和警察的反应也越不一样。
- 委托干净或带瑕疵完成时，代码按星级自动加声望，不用另写。
- 委托以外的事让角色在街上出了名——当众干了件狠事、新闻和网络上传开、帮派里流传角色的事迹——才写 streetCred，事件 id 要能认出是哪件事；私下里的小事、没人看见的事不加。
- 人物的态度跟着声望走：低等级时没人买账，高等级时有人认出、有人巴结，也有人想拿角色立威。`,
};
