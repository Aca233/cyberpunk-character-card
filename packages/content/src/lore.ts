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
    meaning:
      "赛博精神病，与义体负荷、心理创伤和社会压力等因素相关的严重精神失调，不能仅凭义体数量判断",
  },
  { term: "BD", aliases: ["braindance"], meaning: "超梦，录下别人的感官和情绪供人体验" },
  { term: "ICE", meaning: "入侵对抗电子程序，保护系统的防火墙" },
  { term: "input", aliases: ["output"], meaning: "恋人：input 是女朋友，output 是男朋友" },
  { term: "solo", aliases: ["solos"], meaning: "独狼（官方译名），靠枪和义体吃饭的战斗型佣兵" },
  {
    term: "techie",
    aliases: ["techies"],
    meaning: "技术专家（官方译名），修机器、改装备、做陷阱的人",
  },
  { term: "rockerboy", aliases: ["rockergirl"], meaning: "摇滚小子，拿音乐对抗公司和体制的人" },
  {
    term: "jack in",
    aliases: ["jacked in", "jacking in", "jack out", "jacked out"],
    meaning: "接入：把神经接口插进网络或设备；jack out 是断开",
  },
  { term: "Netwatch", meaning: "网络监察，管网络安全、追捕越过黑墙的黑客的组织" },
  { term: "Blackwall", meaning: "黑墙，把旧网里流窜的 AI 挡在外面的屏障" },
  {
    term: "MaxTac",
    aliases: ["Max-Tac", "Max Tac"],
    meaning: "暴恐机动队，NCPD 专门对付赛博精神病的部队",
  },
  { term: "Trauma Team", meaning: "创伤小组，付费会员制的武装急救队，不是客户不救" },
  { term: "NCPD", meaning: "夜之城警察局" },
  { term: "joytoy", aliases: ["joytoys"], meaning: "街头对性工作者的叫法" },
  {
    term: "doll",
    aliases: ["dolls"],
    meaning: "玩偶：装着行为芯片接客、接客时把自己“关掉”的性工作者",
  },
  { term: "scop", meaning: "合成蛋白做的廉价食物，穷人天天吃的那种" },
  { term: "gato", aliases: ["gata"], meaning: "西班牙语“猫”，海伍德街头指哥们、家伙" },
  { term: "hermano", aliases: ["hermana"], meaning: "西班牙语“兄弟”（hermana 是姐妹）" },
  { term: "cabrón", aliases: ["cabron"], meaning: "西班牙语脏话，混蛋" },
  { term: "Delamain", meaning: "德拉曼，AI 开车的出租车公司" },
  { term: "NCART", meaning: "夜之城的轻轨和地铁" },
  { term: "N54", meaning: "N54 新闻台，夜之城最大的新闻网" },
  { term: "biz", meaning: "生意、买卖；“谈 biz”就是谈正事" },
  {
    term: "shard",
    aliases: ["shards"],
    meaning: "分离芯片（官方译名），插进接口就能读，存资料、消息或技能",
  },
  { term: "daemon", aliases: ["daemons"], meaning: "网络黑客放进系统里自动运行的程序" },
  { term: "breach protocol", meaning: "入侵协议：先撬开一个网络接入点，再往系统里传程序" },
  {
    term: "quickhack",
    aliases: ["quickhacks", "quickhacking"],
    meaning: "快速破解（官方译名）：通过网络对目标的设备或义体直接下手",
  },
  {
    term: "scav",
    aliases: ["scavs", "scavenger", "scavengers"],
    meaning: "清道夫，绑人摘义体卖的帮派，人人都恨",
  },
  { term: "gig", aliases: ["gigs"], meaning: "委托，中间人派下来的活" },
  { term: "street cred", aliases: ["cred"], meaning: "街头声望，道上的人认不认你" },
  {
    term: "Sandevistan",
    aliases: ["Sandy"],
    meaning: "斯安威斯坦，让人一瞬间快得像时间变慢的神经加速义体",
  },
  { term: "Arasaka", meaning: "荒坂，日本的安保和军火巨头，夜之城最大的公司" },
  { term: "Militech", meaning: "军用科技，美国的军火巨头，荒坂的死对头" },
  { term: "borg", aliases: ["borgs"], meaning: "义体装得快不像人的家伙，带点轻蔑" },
];

const FAN = "https://cyberpunk.fandom.com/wiki/";

/**
 * 2077 夜之城世界大事件时间线（默认开局 2077-04-12 21:00，按开场后天数推进）。
 * - 无论玩家扮演原创角色还是原作角色 V，本表只提供“无人插手时夜之城各路势力同时在发酵的大势参考”；
 * - 一旦玩家插手或本局已有冲突事实（关键人物生死、地点变化、交易归属），一律以本局事实改写，绝不硬拉回原作；
 * - 未到达的节点不提前剧透，不预设必死的原作悲剧结局。
 */
export const canonTimeline: readonly CanonNode[] = [
  {
    id: "nc-april-undercurrents",
    order: 1,
    phase: "四月暗流",
    title: "军工失窃与沃森暗流",
    fromDay: 0,
    toDay: 4,
    where: "沃森北区、丽姿酒吧、绀碧大厦",
    public:
      "军用科技外勤车队在沃森北区边线失联，公路检查站盘查趋严；N54 财经快讯称荒坂赖宣已高调抵城下榻绀碧大厦顶层套房，引来公司广场多方猜测。",
    hidden:
      "漩涡帮刚发生内讧，罗伊斯将前老大布里克关进旧食品厂暗室夺位，并私吞了此前交易的一批军用科技原型“小平头”战斗机器人；军用科技高级经理梅瑞德斯·斯托特正顶着内部追责压力在沃森暗查内鬼与失货。与此同时，赖宣私下携重要原型离开东京，荒坂总部尚未公开发难；云顶玩偶艾芙琳·帕克近期频繁出入赖宣的套房。",
    hooks: [
      "在沃森北区或公路检查口撞见军用科技黑车封路盘查，听说漩涡帮和公司之间出了批黑货",
      "在丽姿酒吧或日本街听到关于绀碧大厦贵宾和荒坂少爷的只言片语",
      "在歌舞伎或 H10 周边听到街头混混议论漩涡帮换了新老大罗伊斯",
    ],
    basis: "canon",
    source: `《赛博朋克 2077》序章前夕世界局势；${FAN}The_Pickup；${FAN}The_Information`,
  },
  {
    id: "watson-security-tightening",
    order: 2,
    phase: "沃森收紧",
    title: "沃森治安戒备与老牌中间人回城",
    fromDay: 5,
    toDay: 10,
    where: "沃森区、来生酒吧、歌舞伎市场",
    public:
      "NCPD 以打击沃森北区非法军火走私与赛博精神病袭警为由，在通往市政中心和威斯特布鲁克的多座跨海桥口增设临检；来生酒吧圈内则传出离开夜之城两年的大牌中间人德克斯特·德肖恩已经回城的风声。",
    hidden:
      "沃森区桥口安检收紧令走私客和底层佣兵怨声载道，瑞吉娜·琼斯正忙着协调手下留活口调查多起异常赛博精神病案例；德克斯特悄悄接触过几路老关系，打算攒一单足以让他重登巅峰的大买卖（若本局存在 NPC 版 V，杰克、T-Bug 与 V 正被他纳入考察人选；若玩家自己扮演 V，则完全由玩家决定是否接洽），但太平洲旧账的流言仍在暗处发酵。歌舞伎区虎爪帮趁乱试探莫克斯帮地盘，双方摩擦加剧。",
    hooks: [
      "过沃森跨海桥时碰上 NCPD 临检堵车，顺口听巡警吐槽北区最近疯子和黑货越来越多",
      "在来生酒吧或野狼酒吧听到佣兵议论德克斯回城、正打听靠谱的独狼和黑客，杰克等人也在留意风声",
      "在歌舞伎市场目睹虎爪帮收数人与莫克斯帮暗中对峙",
    ],
    basis: "canon",
    source: `《赛博朋克 2077》第一幕沃森封锁前兆与街头生态；${FAN}Watson`,
  },
  {
    id: "arasaka-tokyo-delegation",
    order: 3,
    phase: "黑船压境",
    title: "荒坂鲸鱼号航母抵港",
    fromDay: 11,
    toDay: 16,
    where: "沃森海滨、市政中心、荒坂塔",
    public:
      "荒坂超大型航空母舰“鲸鱼号”悄然驶入夜之城外海锚地，市政中心上空荒坂浮空车起降频次骤增；WNS 与 N54 纷纷报道荒坂高层正就北美业务重组展开闭门磋商，军用科技股价随之承压。",
    hidden:
      "荒坂三郎亲率荒坂华子与贴身保镖竹村五郎从东京抵城，真实意图是收回赖宣私自带出的机密原型并压住家族内部的“鹰派”与“雉派”分裂。荒坂首席生物工程师安德斯·赫尔曼已嗅到家族内斗的血腥味，暗中联络康陶寻找退路。",
    hooks: [
      "在海滨或高处远远看见灯火通明的巨型航母“鲸鱼号”轮廓，全城频道都在议论荒坂动向",
      "在市政中心或来生听到公司中层低声抱怨荒坂安保突然全面升级、审批全线冻结",
      "在黑市消息网听说有人高价打听康陶护航车队或出境伪造身份的门路",
    ],
    basis: "canon",
    source: `《赛博朋克 2077》荒坂鲸鱼号抵港背景；${FAN}Kujira`,
  },
  {
    id: "konpeki-lockdown-rumors",
    order: 4,
    phase: "暗夜惊变",
    title: "绀碧大厦突发封锁与荒坂人事地震",
    fromDay: 17,
    toDay: 22,
    where: "沃森海滨、绀碧大厦、市政中心",
    public:
      "绀碧大厦及周边海滨大道深夜突发最高等级企业封锁，数架荒坂重装浮空车低空盘旋；次日荒坂公关仅宣称“高层安保演习与组织架构调整”，但暗网和地下电台疯传荒坂内部发生重大变故、北美分部高层正在经历剧烈清洗。",
    hidden:
      "若本局无人改写荒坂内斗，赖宣将借突发事变顺势掌控荒坂北美话事权并对外封锁真相，对忠于旧主的高层与保镖展开暗中追捕（若本局存在 NPC 版 V 且未被玩家提前劝阻或截胡，V 与杰克小队可能恰好撞进这场风波）；若本局玩家（含扮演 V 时）或关键人物已经介入荒坂线，则完全以本局实际发生的权斗结果为准，绝不强行照搬原作死伤名单。",
    hooks: [
      "深夜在沃森听见成群浮空车引擎轰鸣掠过海滨，NCPD 频道被荒坂加密信号接管数小时",
      "次日在酒吧或摊位听到各种走样的地下传闻：有人说荒坂内讧，有人说有佣兵闯了绀碧",
      "沃森跨海路障随着风波平息逐步松动，街头中间人开始重新放出跨区委托",
    ],
    basis: "canon",
    source: `《赛博朋克 2077》绀碧大厦风波背景（仅作无人插手时的世界趋势参考，不锁定人物生死）`,
  },
  {
    id: "mayor-rhyne-and-election",
    order: 5,
    phase: "权柄更迭",
    title: "市长卢修斯·莱恩暴毙与补选暗战",
    fromDay: 23,
    toDay: 30,
    where: "市政中心、海伍德、威斯特布鲁克",
    public:
      "夜之城市长卢修斯·莱恩意外身亡，市政府迅速宣布其因“突发心脏衰竭”离世，由副市长韦尔登·霍尔特代理职务；海伍德出身的改革派议员杰弗逊·佩拉莱斯随即宣布参选，全城全息广告牌被激烈的竞选口号刷屏。",
    hidden:
      "莱恩的死因并不单纯，案发现场与监控记录被迅速压下；NCPD 内部高层急于结案，令一向不合群的警探瑞弗·沃德心生疑窦。佩拉莱斯夫妇为了在霍尔特与巨企夹缝中赢得选战，正四处物色信得过的外部调查人手，但他们自己也尚未察觉安保团队里的异常。",
    hooks: [
      "在街头全息大屏或电梯广告里看到佩拉莱斯与霍尔特针锋相对的竞选辩论",
      "在餐馆或 NCPD 附近听到老警员私下抱怨市长案子结得太急、上面不让多问",
      "在海伍德街坊间听说本地走出来的杰弗逊·佩拉莱斯在招外围顾问和安保",
    ],
    basis: "canon",
    source: `《赛博朋克 2077》市长之死与补选背景；${FAN}Lucius_Rhyne；${FAN}Jefferson_Peralez`,
  },
  {
    id: "pacifica-netwatch-standoff",
    order: 6,
    phase: "深网暗涌",
    title: "太平洲信号异常与大帝国商场对峙",
    fromDay: 31,
    toDay: 38,
    where: "太平洲、大帝国商场",
    public:
      "太平洲海岸废墟一带连日出现不明强电磁干扰，周边廉价义眼和民用通讯频繁雪花断线；街面传闻“动物帮”大队人马近期开进了荒废已久的大帝国商场，巫毒帮地盘气氛骤然紧张。",
    hidden:
      "网络监察资深探员布莱斯·莫斯利暗中雇佣萨斯夸奇率领的动物帮进驻大帝国商场作为掩体，架设信号监测阵以锁定巫毒帮越过黑墙的节点；布丽奇特与普拉西德正一边清理外围眼线，一边寻找能用来探路的外部佣兵。",
    hooks: [
      "靠近太平洲或听电台时收到杂音与关于大帝国商场来了帮肌肉怪物的传闻",
      "在黑客圈或歌舞伎芯片摊听到有人警告最近别随便连太平洲的野生子网",
      "听说网络监察正在高价收购关于海地黑客动向的蛛丝马迹",
    ],
    basis: "canon",
    source: `《赛博朋克 2077》太平洲大帝国商场对峙背景；${FAN}I_Walk_the_Line`,
  },
  {
    id: "badlands-convoy-and-kangtao",
    order: 7,
    phase: "恶土风沙",
    title: "恶土空域事故与游牧家族裂痕",
    fromDay: 39,
    toDay: 46,
    where: "恶土、圣多明戈边缘",
    public:
      "恶土东侧荒漠爆发剧烈电磁脉冲异常，周边发电站一度跳闸，一架康陶企业浮空车被迫降后与武装车队失去联系；军用科技趁机加强恶土公路哨卡，乱刀会夜游鬼频繁袭扰过往货车。",
    hidden:
      "康陶与荒坂围绕流失技术人才的暗战波及恶土；阿德卡多游牧营地处境雪上加霜，索尔·布赖特倾向签下生物技术外包合同以保族人度日，帕南·帕尔默与米契等老兵则坚拒给公司当狗，营地内部矛盾与夜游鬼的威胁随时可能引爆。",
    hooks: [
      "在恶土公路或城边加油站看到康陶和军用科技的武装浮空车低空搜寻",
      "从达科塔的修车厂或流浪者频道听闻阿德卡多营地最近人手紧缺、和夜游鬼摩擦不断",
      "在圣多明戈老船长地界听到有人在黑市倒卖从恶土捡来的康陶精密零件",
    ],
    basis: "canon",
    source: `《赛博朋克 2077》恶土空域与阿德卡多局势；${FAN}Life_During_Wartime`,
  },
  {
    id: "japantown-dashi-parade",
    order: 8,
    phase: "霓虹祭典",
    title: "日本街荒魂祭筹备与花车游行",
    fromDay: 47,
    toDay: 54,
    where: "威斯特布鲁克、日本街、扭扭街",
    public:
      "荒坂赞助的传统大型庆典“荒魂祭”进入最后彩排，日本街高空架起巨型全息锦鲤与传统花车轨道，威斯特布鲁克安保等级拉满；商贩们一边指望人流赚钱，一边抱怨虎爪帮趁节日抬高摊位费。",
    hidden:
      "荒坂安保精锐（含小田三太夫在内的贴身防卫力量）将游行视作高危安保窗口，沿街高台布满狙击点与加密无人机；冈田和歌子借机整理日本街情报脉络，而对荒坂怀有各自算盘的势力与潜伏者也在筹划借盛典人潮传递密信或制造混乱。是否发生袭击或追悼性质，全看本局前期荒坂线实际走向。",
    hooks: [
      "走进日本街就能看到高空试飞的全息锦鲤与正在焊接花车轨道的施工队",
      "在和歌子的柏青哥店或扭扭街酒吧听说虎爪帮正高价招临时外围安保",
      "街头流行女团“刚烈”的宣传车在威斯特布鲁克巡游，乐迷和克里老粉在网上吵成一片",
    ],
    basis: "canon",
    source: `《赛博朋克 2077》日本街花车游行背景；${FAN}Play_It_Safe`,
  },
  {
    id: "dogtown-airspace-incident",
    order: 9,
    phase: "墙内风暴",
    title: "狗镇空域坠机与幽冥犬戒严",
    fromDay: 55,
    toDay: 64,
    where: "狗镇、太平洲边界",
    public:
      "一架来源不明的改装轨道穿梭机在狗镇体育场附近强行迫降并起火，幽冥犬民兵第一时间封锁整片坠机街区并对外宣称击落“越境走私机”；狗镇黑市军火与加密芯片价格应声暴涨。",
    hidden:
      "若本局前期无人提前改写华盛顿与狗镇格局，新美国总统迈尔斯与百灵鸟的秘密博弈将在狗镇引爆，潜伏夜之城七年的联情局特工所罗门·李德与亚历克斯也可能被唤醒，与库尔特·汉森及幕后操盘手汉兹先生展开多方角力。",
    hooks: [
      "在太平洲边界远远望见狗镇高墙内升起浓烟，巴格斯特装甲车把检查站堵得水泄不通",
      "听到黑市掮客私下传言重石俱乐部的汉兹先生正在物色敢进墙内办脏活的狠角色",
      "在市中心戴诺酒吧附近注意到平时话不多的门卫李德神情凝重、频繁查看老式加密终端",
    ],
    basis: "canon",
    source: `《赛博朋克 2077：往日之影》狗镇坠机背景；${FAN}Dog_Eat_Dog`,
  },
  {
    id: "nc-summer-power-shift",
    order: 10,
    phase: "盛夏洗牌",
    title: "仲夏格局重排与新一轮暗战",
    fromDay: 65,
    toDay: 90,
    where: "全城各区",
    public:
      "入夏的夜之城酸雨与酷暑交替，历经前两个月的企业动荡、补选混战与狗镇风波，荒坂、军用科技、康陶与各路帮派的势力边界进入新一轮冷战对峙，来生酒吧的委托板再次热闹起来。",
    hidden:
      "旧的风波余波未散，幸存下来的赢家正在消化地盘与资产，输家则在暗处舔伤图谋反扑；本局此前所有被玩家改变或未解决的恩怨、人情债与势力洗牌将成为接下来主导城市走向的真正主线。",
    hooks: [
      "在来生或各区酒吧听见佣兵们复盘过去两个月全城的大事，顺带提起玩家自己闯出的名声",
      "各区中间人开始放出针对新势力格局的高回报委托",
    ],
    basis: "adapted",
    source: "本作 2077 自由沙盘中长期生态演进节点",
  },
];
