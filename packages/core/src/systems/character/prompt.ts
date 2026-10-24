import type { RuleModule } from "../../kernel/system";
import { type CharacterState, FLASHBACK_TURNS } from "./schema";

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

export const flashbackRules: RuleModule<CharacterState> = {
  id: "flashback",
  title: "过往闪回",
  commands: ["flashback"],
  when: (state) => state.flashback !== null || state.traits.some((t) => t.slot === "past"),
  text: `- 遇到和某段过往有关的人、地点或物品时，可以写 {"type": "flashback", "past": "过往的名字"} 插一段闪回；past 只能写状态里“还能闪回的过往”，每段过往一生只闪回一次；战斗中不开，一般也不在紧要关头开。
- 闪回最多 ${FLASHBACK_TURNS} 轮：正文写当年的那一幕，让玩家在闪回里做选择，用来补全这段过往。闪回里不掷骰、不推进时间、不记账：不写 check，选项不带检定，changes 里只写 flashback，别的指令代码会丢掉。
- 闪回的最后一轮写 {"type": "flashback", "action": "end", "fact": "一句话"}，把这段闪回里确认的事写成已确定的事实；不能和已有事实、角色简介矛盾。带出的旧识如果还活着，回到现在后可能出场。`,
};
