import type { CanonNode, Slang } from "@cp/core";

/** 黑话术语表：正文里鼠标悬停显示释义 */
export const glossary: readonly Slang[] = [
  { term: "choom", aliases: ["chooms"], meaning: "朋友、兄弟，街头对熟人的称呼" },
  { term: "gonk", aliases: ["gonks"], meaning: "蠢货、笨蛋" },
  { term: "preem", meaning: "顶级的、一流的（premium 的缩写）" },
  { term: "nova", meaning: "酷、好极了" },
  { term: "delta", meaning: "离开、溜走；“快 delta”就是赶紧撤" },
  { term: "eddies", aliases: ["eddie", "eddy"], meaning: "欧元，夜之城的通用货币" },
  {
    term: "flatline",
    aliases: ["flatlined", "flatlining"],
    meaning: "停搏（官方译名）：杀死；也指脑波归零、死掉",
  },
  { term: "zero", aliases: ["zeroed"], meaning: "干掉、杀掉" },
  { term: "chrome", meaning: "义体，泛指装在身上的机械和电子改造" },
  {
    term: "ripperdoc",
    aliases: ["ripperdocs", "ripper"],
    meaning: "义体医生，给人装、修、拆义体的街头医生",
  },
  {
    term: "netrunner",
    aliases: ["netrunners"],
    meaning: "网络黑客（官方译名），用神经接口潜入网络、破解系统的人",
  },
  { term: "fixer", aliases: ["fixers"], meaning: "中间人，替客户找佣兵、谈价钱、派活的人" },
  {
    term: "edgerunner",
    aliases: ["edgerunners"],
    meaning: "边缘行者（游戏里译作“边缘人”），游走在法律和生死边缘的街头佣兵",
  },
  { term: "merc", aliases: ["mercs"], meaning: "佣兵，拿钱办事的人" },
  {
    term: "corpo",
    aliases: ["corpos"],
    meaning: "公司员工（官方译名），街头也骂“公司狗”，也指公司那套做派",
  },
  {
    term: "nomad",
    aliases: ["nomads"],
    meaning: "流浪者（官方译名），在城外恶土上以家族为单位生活的车队",
  },
  {
    term: "cyberpsycho",
    aliases: ["cyberpsychos", "cyberpsychosis"],
    meaning: "赛博精神病，义体装得太多、人性崩溃后失控的人",
  },
  { term: "BD", aliases: ["braindance"], meaning: "超梦，录下别人的感官和情绪供人体验" },
  { term: "ICE", meaning: "入侵对抗电子程序，保护系统的防火墙" },
  { term: "input", aliases: ["output"], meaning: "恋人：input 是女朋友，output 是男朋友" },
];

const FAN = "https://cyberpunk.fandom.com/wiki/";

/**
 * 原剧时间线：《赛博朋克：边缘行者》第 1–3 集，给以后的 2075 剧本用；现在只做 2077 开局，gameData 里不带。
 * 剧情照原剧（出处见 source，2026-10-25 查）；第几天是本作改编：第 3 集时格洛丽亚已经死了两天。
 * 年份：维基百科引 R. Talsorian《Edgerunner's Handbook》写第 1–6 集在 2075 年、第 7 集起 2076 年（原作依据）；2075 剧本照这个开局。
 * 人物译名待核对。
 */
export const canonTimeline: readonly CanonNode[] = [
  {
    id: "let-you-down",
    episode: 1,
    title: "Let You Down",
    fromDay: 0,
    toDay: 1,
    where: "公司广场、圣多明戈",
    public:
      "公司广场附近一个重度义体化的军人发了赛博精神病，暴恐机动队当街把他放倒；N54 报道说他身上的军用义体下落不明。同一晚圣多明戈有帮派飞车扫射，一名急救员被送进廉价诊所后没救回来。",
    hidden:
      "发疯的是新美国军方的诺里斯中校，丢的是他的军用斯安威斯坦。急救员格洛丽亚·马丁内斯私下把尸体上拆的义体卖给曼恩，那台斯安威斯坦就在她包里。她儿子大卫在荒坂学院念书，家里穷，用义体医生 Doc 给的违规更新改了视觉显示，把学校系统搞坏了，母亲刚被叫去见校长；回家路上撞上动物帮的飞车扫射，创伤小组因为他们不是客户拒绝出动，格洛丽亚死在廉价医院。大卫在她包里找到斯安威斯坦，Doc 先出一万又压到六千；同学田中克雄带着装了大力臂的跟班揍了他、嘲笑他，他决定自己装上。",
    hooks: [
      "在公司广场附近撞上封锁现场，听到军用义体丢了的风声",
      "在圣多明戈的诊所或义体医生那里碰上一个刚死了母亲、手里有好货的少年",
      "曼恩那边在等一批货，送货的人一直没来",
    ],
    basis: "canon",
    source: `《边缘行者》第 1 集；${FAN}Let_You_Down；https://en.wikipedia.org/wiki/Cyberpunk:_Edgerunners`,
  },
  {
    id: "like-a-boy",
    episode: 2,
    title: "Like A Boy",
    fromDay: 1,
    toDay: 2,
    where: "荒坂学院、NCART 轻轨、圣多明戈",
    public:
      "荒坂学院有个学生把同学打得很惨，录像在网上传开，打人的被开除。轻轨上最近有人专扒公司职员。",
    hidden:
      "Doc 给大卫装上斯安威斯坦，他在学院打了田中克雄，被录下来开除；荒坂的田中先生和马库斯注意到他，想拿他试他们的「产品」。大卫在轻轨上遇见扒荒坂职员的露西，两人搭伙，七三分账；他连开八次斯安威斯坦倒下，一个黑心急救员想摘他的义体，被露西救下。Doc 给他开了免疫抑制剂，警告他别再这么用。当晚露西带他回公寓，在他外套上写了「Edgerunners」，两人一起看月球超梦；露西事先通知了曼恩，曼恩带着多里奥和皮拉尔上门要那台斯安威斯坦。",
    hooks: [
      "在轻轨上撞见一对少年扒手下手，或者自己成了他们的目标",
      "圣多明戈街头有个开义体开到倒地的少年，旁边一个急救员神色不对",
      "有人在打听一台军用斯安威斯坦的下落",
    ],
    basis: "canon",
    source: `《边缘行者》第 2 集；${FAN}Like_A_Boy`,
  },
  {
    id: "smooth-criminal",
    episode: 3,
    title: "Smooth Criminal",
    fromDay: 2,
    toDay: 3,
    where: "曼恩的仓库、一场拳赛、一家酒吧、街头追车",
    public:
      "一场拳赛被人做了手脚；有人给一伙街头佣兵挂了赏金，虎爪帮当街追车开火，最后一个追的人被打死在路边。",
    hidden:
      "曼恩就是格洛丽亚的买家，知道大卫是她儿子后收他当学徒。学院校长给大卫奖学金让他回去，他后来拒绝了。曼恩一伙（多里奥、皮拉尔、琪薇、丽贝卡、法尔科、露西）接了法拉第的活：从荒坂高管田中的司机兼保镖马克西姆·库兹涅佐夫那里弄到田中的行车路线，借一场做了手脚的拳赛、一家酒吧和田中的车下手。活办得很糙，马克西姆给他们挂了赏金，虎爪帮一路追杀，曼恩打死了最后一个。法拉第骂他们办砸了，让他们等田中的新动向；丽贝卡欢迎大卫入伙。",
    hooks: [
      "法拉第手上的单子撞到同一个目标：荒坂的田中",
      "在拳赛场或酒吧里认出一伙张扬的边缘行者在踩点",
      "虎爪帮在找一伙挂了赏金的人，有人出价买消息",
    ],
    basis: "canon",
    source: `《边缘行者》第 3 集；${FAN}Smooth_Criminal`,
  },
];
