import type { RuleModule } from "../../kernel/system";
import type { FactionsState } from "./schema";

/** 输入里像和势力有关的说法 */
const WORDS =
  /帮|公司|荒坂|军用科技|康陶|生物技术|沛卓|NCPD|警察|条子|创伤小组|网络监察|暴恐|清道夫|夜游鬼|阿德卡多|幽冥犬|流浪者|地盘/i;

export const factionRules: RuleModule<FactionsState> = {
  id: "factions",
  title: "势力和态度",
  commands: ["faction"],
  when: (_state, input) => input.mode !== "ooc" && WORDS.test(input.text),
  narrate: `- 帮派是街上的事：在自己地盘上盘问生面孔、收保护费、记仇；见面就打的会直接开火；穿对头帮派的颜色进地盘会惹麻烦。
- 公司是看不见的事，很少亲自出手：惹了它先是被监视、门禁卡失效、身边的人被收买，再到雇人来找你；修复关系靠中间人斡旋或一笔交易。
- 态度是标签不是数值：写成人物的反应和街上的气氛，不在正文里报"态度变了"。`,
  text: `- 势力对玩家的态度只有五档：kos 见面就打、hostile 敌对、neutral 中立、friendly 友好、family 自己人（公司分别叫清除目标、列入档案、不在意、有用的外包、公司资产）。【当前状态】里列着势力 id 和不是中立的态度，以及这里是谁的地盘。
- 发生了足以改变整个组织看法的事（杀了他们的人、坏了他们的买卖、替他们办成事、救了他们的人）才写 faction：id 写势力 id，attitude 写新的一档，reason 一句话写凭的是哪件事；一次最多变两档，小摩擦不写。
- 对一个有卡的人的好感照常写 npc；faction 是整个组织的看法，两者可以不一样。`,
};
