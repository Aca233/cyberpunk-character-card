import type { RuleModule } from "../../kernel/system";
import type { FactionsState } from "./schema";

export const factionRules: RuleModule<FactionsState> = {
  id: "factions",
  title: "势力和态度",
  commands: ["faction"],
  when: (_state, input) => input.mode !== "ooc",
  judge: `- 势力立场与归属决定地盘风险与交涉门槛：走进见面就打（kos）的势力地盘极易遭遇拦截或伏击，在敌对（hostile）地盘露面容易被盯梢盘问；公司倾向借门禁失效、安保排查或雇佣外包施压。已加入某势力的正式成员在其地盘享有门禁放行与照应，但在其死对头地盘暴露身份更易立刻冲突。
- 自由入帮与双向帮规：非敌对势力即可通过引荐人（有卡活人）、面试/签约或现场立功谈成加入，不死卡单一流程；但正式成员若私吞货款、背刺同伙、严重泄密或关键帮务放鸽子，会吃内部追责（污点满 3 笔直接除名并触发清理门户）。
- 内部派系与抢地盘必须落到实处：无论是否入帮，玩家都可站队某派、协助政变或主动端据点/斩首头目搅动地盘；但不能空口改写政局或地盘，必须有真实行动或真实关键 NPC（含生死变故）支撑。`,
  narrate: `- 帮派是街上的事：在自己地盘上盘问生面孔、收保护费、记仇；见面就打的会直接开火；穿对头帮派的颜色进地盘会惹麻烦。火拼争夺中的城区街头设卡、店铺紧闭或提价、气氛高度紧张。
- 公司是看不见的事，很少亲自出手：惹了它先是被监视、门禁卡失效、身边的人被收买，再到雇人来找你；修复关系靠中间人斡旋或一笔交易。
- 【这里是谁的地盘】与【人物】档案里带着真实掌权派系、引荐人生死、帮规污点与 NPC 派系立场：引荐人死了按玩家当前头衔、实力与人脉实事求是地写（新人少个照应，高层或强者反可稳住旧部甚至顺势接盘）；掌权领袖死了就写内部群龙无首与各方抢权，与某派系 NPC 对话时自然按彼此同派/对派立场演戏，不在正文里报"态度变了"或"记了一笔污点"。`,
  text: `- 势力对玩家的态度只有五档：kos 见面就打、hostile 敌对、neutral 中立、friendly 友好、family 自己人（公司分别叫清除目标、列入档案、不在意、有用的外包、公司资产）。【当前状态】列着当前归属、内部派系、火拼争夺区与非中立态度。
- 发生了足以改变整个组织看法的事（交火击杀/重创该势力多名成员、端掉据点、坏了大买卖、替他们办成关键大事、救下骨干）时务必写一条 faction（action:"stance" 或省略 action）：id 写势力 id，attitude 写新的一档，reason 写凭哪件事；一次最多变两档，小摩擦不写。
- 正式加入 / 晋升 / 脱离 / 帮规污点（自由单归属，中立以上均可入伙，不强制刷满关系）：
  - 剧情里正式入帮/入职写 faction（action:"join", id, rank:"头衔", sponsor:"可选引荐人NPC的id", reason）；若是走熟人/大佬/中间人引荐就填 sponsor，若是面试/签约/无现成人物则不填。代码自动同步对头敌对与盟友友好。
  - 帮内晋升或调岗写 faction（action:"rank", id, rank:"新头衔", reason）。
  - 和平脱离/辞职写 faction（action:"leave", id, reason）；叛帮/背刺原组织加 betrayal:true（直接转 kos）。
  - 正式成员在正文里真正触犯组织底线（私吞、背刺同伙、严重泄密、放鸽子）时写 faction（action:"strike", id, byNpc:"可选追责人NPC的id", reason），满 3 笔代码自动除名并清理门户；立功/赔罪/打点摆平写 action:"clearStrike"（可带 byNpc）。不要为日常不接单乱记污点。
- 内部派系站队与政变（见【当前状态】里的内部派系 id，无论是否入帮都可参与）：
  - 玩家明确站队某派或帮某派办事时写 faction（action:"wing", id, wing:"派系id", reason）。
  - 剧情里政变、推举新老大或某派正式掌权时写 faction（action:"wing", id, ruling:"新掌权派id", leaderNpc:"活着的领头NPC的id", reason）；若该派没有活着的预设领袖，须先用 npc 给新话事人建卡再填 leaderNpc，绝不空口易主。
- 玩家主动抢地盘 / 触发火拼争夺（不再只能干等场外推演）：
  - 玩家端掉据点、烧仓库、斩首头目令某区爆发火拼时写 faction（action:"turf", id:"主导势力id", district:"城区名", turfChange:"contest", rival:"可选对头势力id", leadNpc:"可选关键NPC id", reason）。
  - 某一方彻底拿下或被逐出该城区时写 action:"turf", turfChange:"gain" 或 "lose"（拿下且把对头赶走可同时填 rival，代码立刻结算易主并解除争夺态）。
- 对单个有卡人物的关系变化照常写 memory / ledger / relation；帮了一边升到友好以上时代码自动让对头降一档，不要另写对头的 faction。`,
};
