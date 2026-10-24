import type { RuleModule } from "../../kernel/system";
import { MESSAGES_PER_TURN, type PhoneState } from "./schema";

export const phoneRules: RuleModule<PhoneState> = {
  id: "phone",
  title: "手机消息",
  when: () => true,
  text: `- 不在场的人联系玩家，用指令块顶层的 messages：[{"from": "人物或中间人 id，或者名字", "text": "消息原文"}]，每轮最多 ${MESSAGES_PER_TURN} 条。中间人派单和催单、到期事件逼近、NPC 的离屏进展、旧识找上门，都可以发一条；写得像真的短信：短、口语，不解释规则。
- 消息由代码按游戏时间记进手机；正文里只写“手机震了一下”这类动静，不把原文再抄一遍。
- 玩家输入带【回复手机消息 #n】时，这一轮是在手机上回第 n 条（状态里列着最近的消息）；回复算一轮行动，对方回不回、怎么回按人物来写，要回就再用 messages 发。
- 战斗、潜入和闪回里不发消息，除非这条消息就是要引出的事。`,
};
