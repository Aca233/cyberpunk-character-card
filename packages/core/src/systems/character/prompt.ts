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

export const habitRules: RuleModule<CharacterState> = {
  id: "habits",
  title: "别人眼里的你和习惯",
  commands: ["habit"],
  when: () => true,
  text: `- 状态里的“别人眼里的你”由代码按出身、口音、穿着、看得见的义体、伤势、声望和热度拼成：NPC 的第一反应照这一行写（公司出身进歌舞伎町的小店会被当成冤大头，流浪者进公司大楼保安会多看两眼，浑身是铬的人让老人躲开）。换衣服、藏起义体、伪装身份会改变这一行；伪装骗不骗得过对方按意图优先和门槛判定。
- 角色的习惯是硬设定：写休整、日常和熟人的反应时优先用上（常去的店老板认得角色、记得常点什么），但不据此替角色做选择。
- 剧情里角色反复做同一件小事（总去同一家面摊、开车总放同一个台），可以写 habit 提议成习惯，一句话；玩家确认才写进角色卡。一场最多提一条，没有合适的就不写，已经提过的不要再提。`,
};
