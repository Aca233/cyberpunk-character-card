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

export const agendaRules: RuleModule<FactionsState> = {
  id: "agendas",
  title: "势力动向",
  commands: ["agenda", "agendaTold"],
  when: (state, input) =>
    input.mode !== "ooc" &&
    (Object.values(state.agendas ?? {}).some((p) => p.moves.length > 0) || WORDS.test(input.text)),
  narrate: `- 【势力动向】是各势力背地里在打的主意和最近真发生了的事。打算不是剧本：怎么走、成不成，由场外推演按局面写，你不替它们往前走，也不写还没发生的结果。
- 标着「玩家还没听说」的事，找合适的机会借 N54 新闻、电台、街头传闻、中间人或熟人的消息透出来，用你自己的话、带着说话人的立场和偏见；一轮最多透一件，战斗、潜入和闪回里不透。
- 「可能接着」只是苗头，可以埋伏笔（人手调动、谁在打听什么、街上多了生面孔），不要写成已经发生。
- 玩家走进相关的城区或碰上相关的人，可以让动向自然露出来，给玩家插手的机会；不硬塞。
- 地盘变了的，按现在的地盘写街上的样子：新来的在立规矩，老地头在找机会抢回来。`,
  text: `- 正文里让玩家听说了某条动向最近的事（新闻、传闻、消息、有人亲口说），写 agendaTold，id 写动向 id；只听到风声、没说清是哪件事的不算。
- 玩家亲手插手了某条动向才写 agenda：帮它办成一件关键的事写 push（马上到点，下次推演这个势力得手）；拖住它（毁了货、抓了人、报了信）写 stall，之后两轮不会到点；彻底坏了它的事（干掉主事的人、端了据点、把证据交给对头）写 derail，这个势力要隔一周才换个法子再来。reason 一句话写玩家做了什么。只是听说、议论不算插手。`,
};
