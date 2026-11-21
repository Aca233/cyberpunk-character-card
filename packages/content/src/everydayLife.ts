import { npcRules } from "@cp/core";

/**
 * 夜之城神经接口与红灯区三层生态常驻人物（2077-04-12 校准）：
 * 1. 歌舞伎市场：阿岚（正版+灰市音像芯片摊主）
 * 2. 丽姿酒吧：莫克斯武装维序与感官超梦会所（朱迪、苏西·Q、丽塔在 npcs.ts）
 * 3. 云顶（H8）：前台安检 + 玩偶丝凯/安吉尔（植入 doll-behavior-chip，遵循安全词与记忆断层；舞子、木头人在 npcs.ts）
 * 4. 扭扭街：街头性偶（本人清醒接客，无行为芯片）+ 黑超梦暗摊贩子
 */
export const everydayPeople = npcRules.NpcCardSchema.array().parse([
  {
    id: "sleeve-shop-keeper",
    name: "阿岚",
    age: 38,
    adult: true,
    entity: "human",
    pronoun: "她",
    role: "歌舞伎市场芯片小铺店主，专营商业超梦、协议芯片与灰市读写器材",
    faction: "none",
    look: "齐耳栗色短发用两枚金属发卡别住，眼角有常年熬夜盯波形留下的细纹，左手食指是哑光银义指，指腹磨得发亮。",
    outfit: "褪色旧摇滚演出衫外罩多口袋技师背心，胸口别着隔离读写器探针，腰间挂一串防静电芯片盒。",
    voice:
      "语速麻利带点歌舞伎老摊主的精明和护短，招呼生客公事公办，会顺口提醒来路不明的加密片别直接插脖子；熟客问起灰市货才会把嗓音压低半度。",
    samples: [
      "正版商业超梦和语言芯片都在明面架子上；想碰来路不明的加密片，先买台隔离读写器查查有没有黑冰，烧坏脑子我可不退货。",
      "编辑头环可不便宜，但你要扒调查原片里的视觉、音频和热感线索，普通花环根本切不开图层。",
      "老规矩，芯片拆封插过槽就不退。你要是真捡到什么带公司密标的硬货，关门后再敲后窗。",
    ],
    bio: "早年在沃森一家小型音像压片厂当质检员，厂子被公司并购裁员后靠着攒下的几台二手检测仪在歌舞伎市场支起小铺。十年来练就了扫一眼封装就能辨出残次黑冰的眼力，跟市场里卖铁器的阿涛、义体医生针眼互有照应，却始终不肯彻底倒向任何帮派。",
    want: "把小铺做成歌舞伎最稳当的芯片与超梦器材中转点，多攒点真欧把楼上那间潮湿阁楼换成带独卫的公寓。",
    limit:
      "绝不碰清道夫出品的无滤波血腥 XBD，不替客人担保未破译黑片的安全性，也不会把熟客的购货清单卖给虎爪帮或 NCPD。",
    secret:
      "她手里偷偷收着几份从公司报废终端流出的老旧调试协议，定期通过匿名中转卖给沃森独立黑客换高额佣金；若被虎爪帮或网监盯上，整间铺子都会保不住。",
    home: "kabuki-market",
    hangouts: ["lizzies-bar", "tom-diner"],
    initialDoing:
      "趁着晚上人流还没散，在柜台后检修一台刚收进来的二手超梦编辑头环，顺便核对本周货单。",
    canon: false,
    body: {
      gear: [
        "techie-coverall",
        "street-tee",
        "cargo-pants",
        "street-sneakers",
        "chip-reader-writer",
        "tool-kit",
        "blank-shard",
      ],
      cyberware: ["kiroshi-mk1"],
    },
  },
  {
    id: "clouds-receptionist",
    name: "云顶前台接待员",
    alias: "千绘",
    age: 29,
    adult: true,
    entity: "human",
    pronoun: "她",
    role: "超级摩天楼 H8 云顶俱乐部前台，负责存枪安检与个人链路算法匹配",
    faction: "tyger-claws",
    look: "齐刘海黑色短发修得像尺子量过，妆容精致得像全息广告，眼角嵌着微闪浅蓝光的数据导流饰条，笑起来眉梢却不动。",
    outfit: "樱花粉与哑光黑拼接的云顶制式修身裙，细跟鞋擦得锃亮，左耳麦直连虎爪帮安保频道。",
    voice:
      "永远挂着标准化的礼貌微笑和轻柔播音腔，字正腔圆、滴水不漏；一涉及武器寄存、包厢规矩或后台禁区，嗓音里的机械冷感立刻浮出来。",
    samples: [
      "欢迎来到云顶，请先将所有枪械与重刃寄存进安保柜，再接入个人链路进行算法匹配。",
      "系统已为您匹配最契合潜意识需求的玩偶。请记住您的安全词「山茶花」，任何时刻念出即可中止托管。",
      "抱歉，贵宾通道与维护区仅限授权人员进入。若您对服务有任何意见，我可以为您记录并转呈管理层。",
    ],
    bio: "原本在威斯特布鲁克一家高端酒店做礼宾，因为家里欠下虎爪帮赌场债被调进 H8 云顶当前台。几年下来学会了把所有情绪锁在职业微笑后面，既怕楼上管事舞子和木头人拿她撒气，也清楚在这张柜台后面闭嘴最能活命。",
    want: "平稳走完每一班流程不出安保事故，尽快攒够钱把妹妹的债务从虎爪帮账本里彻底划掉。",
    limit: "绝不允许客人带枪进包厢区，绝不当面泄露贵宾名单、包厢监控规律或后台服务器位置。",
    secret:
      "她暗中把几位常来云顶的公司高管出入时段记在私密加密备忘里当保命筹码，生怕哪天木头人把楼里的破事推到前台头上。",
    home: "clouds",
    hangouts: ["japantown"],
    initialDoing: "正在前台核对今晚预约名单，同时留意虎爪帮安保频道里关于电梯层人流的提醒。",
    canon: false,
    body: {
      gear: ["club-dress", "dress-shoes", "holo-phone", "shard-intel-clouds-manual"],
      cyberware: ["kiroshi-mk1"],
    },
  },
  {
    id: "skye-clouds",
    name: "丝凯",
    age: 26,
    adult: true,
    entity: "human",
    pronoun: "她",
    role: "云顶在班玩偶，植入玩偶行为芯片，托管期间本人无意识",
    faction: "none",
    look: "浅金波浪发垂过肩头，眼底藏着一层化不开的倦意，锁骨与颈侧行为芯片接口处泛着微弱的冷蓝指示灯。",
    outfit: "淡米色丝质吊带长裙与半透明轻纱披肩，腕间套着云顶编号手环。",
    voice:
      "切入 doll 托管时声音空灵笃定，能顺着算法读出的渴望轻声剖白心结；退出托管回到清醒（off）后语调骤然变得戒备疲惫，句尾常带下意识的停顿。",
    samples: [
      "（托管态）你一直在找一个不会背叛你的地方……在这里，你可以暂时把枪放下来，听听自己真正怕的是什么。",
      "（清醒态）等等——刚才那是安全词？我……我不记得刚才聊了什么。你是来找人的，还是真来消费的？",
      "（清醒态）别在包厢里大声提木头人的名字，走廊那头全是虎爪帮的人。有事快说，我下一班快到了。",
    ],
    bio: "原本怀着去城西念艺术设计的念头来夜之城，却被一纸写满违约条款的演艺中介合同拐进了云顶。行为芯片替她扛下了上班时的所有台词与情绪，却也把她的日子切成了无数空白碎片；醒着的时候，她比看上去敏锐得多，始终在留心姐妹们的安危。",
    want: "攒够违约金赎回合同离开云顶，摆脱虎爪帮、舞子与木头人的掌控，过上清醒完整的日子。",
    limit: "极度厌恶客人趁托管结束后的记忆断层套话或欺压；涉及木头人和失踪玩偶时会本能警惕。",
    secret:
      "她私下和同楼的安吉尔偷偷对过排班与异常离岗记录，隐约察觉木头人会把出了芯片故障的玩偶送去见不得光的地方，却手里还缺实据。",
    home: "clouds",
    hangouts: ["japantown"],
    initialDoing: "刚结束上一班托管，在包厢化妆台前缓神喝温水，揉着发胀的后颈接口等待下一次呼叫。",
    canon: true,
    body: { gear: ["club-dress", "dress-shoes", "holo-phone"], cyberware: ["doll-behavior-chip"] },
  },
  {
    id: "angel-clouds",
    name: "安吉尔",
    age: 28,
    adult: true,
    entity: "human",
    pronoun: "他",
    role: "云顶在班玩偶，植入玩偶行为芯片，托管期间本人无意识",
    faction: "none",
    look: "深棕微卷发梳得随性，右眉骨有一道极细的旧疤，耳后与锁骨间嵌着精致的神经镀铬饰条，醒着时眼神总透着克制。",
    outfit: "暗色丝绸开领衬衫与修身长裤，脚踩软底皮鞋，手腕戴着云顶工牌环。",
    voice:
      "托管态温润克制、善于共情引导，语速舒缓得像深夜电台；退回清醒态后说话简短实际，习惯先扫一眼包厢门锁与摄像头再开口。",
    samples: [
      "（托管态）整座夜之城都在催你往前跑，可你心里其实怕停下来就没人记得你。",
      "（清醒态）托管刚断，我脑子里那段是空的。如果你不是来寻欢的，说话小点声，走廊有虎爪帮的人。",
      "（清醒态）丝凯心太软，总想硬扛。在这栋楼里，活着熬到解约比什么都重要。",
    ],
    bio: "在海伍德底层长大，为了凑齐母亲的肺部人工替代件手术费签进云顶。他很早便明白云顶的温柔全是算法包装出来的生意，醒着时话不多、记性极好，总在后台茶水间替新来的玩偶挡掉不少麻烦。",
    want: "在云顶平平安安撑过合约期，顺便护着丝凯和其他熟识的同伴别落进木头人手里。",
    limit: "绝不替虎爪帮害人，不愿在没有保护的情况下卷入与舞子或木头人的正面火拼。",
    secret:
      "他偷偷留着一张已离职老员工留下的维修走廊旧门禁卡，本来打算万一出事时用来带丝凯脱身，连丝凯本人都还不知道。",
    home: "clouds",
    hangouts: ["japantown"],
    initialDoing: "在云顶员工休息廊擦拭袖口，留心着包厢区的灯光提示和安保换班动静。",
    canon: true,
    body: {
      gear: ["silk-shirt", "tailored-slacks", "dress-shoes", "holo-phone"],
      cyberware: ["doll-behavior-chip"],
    },
  },
  {
    id: "jigjig-joytoy-f",
    name: "莉娜",
    age: 27,
    adult: true,
    entity: "human",
    pronoun: "她",
    role: "扭扭街街头性偶，本人清醒接客（无行为芯片），消息灵通",
    faction: "none",
    look: "霓虹紫渐变短发，唇角闪着冷金属光泽，左肩有一片廉价全息樱花纹身，眼神亮而机警，一看就混惯了夜街。",
    outfit: "透明 PVC 短外套内搭亮片紧身衣与皮裤，靴筒边和腰侧挂着防身电击棒。",
    voice:
      "干脆泼辣、明码标价，带点夜之城老油条的幽默和嘴毒；给够欧元或递根烟，顺嘴就能抖出不少扭扭街暗巷的真料。",
    samples: [
      "一百欧元，本人清醒伺候，不玩云顶那套芯片洗脑。要聊情报？另算钱，别想白嫖消息。",
      "别往那边巷尾瞎晃，昨天还有个穿清道夫破夹克的家伙在那儿跟灰舌交头接耳。",
      "在扭扭街混饭吃，眼珠子得比霓虹灯转得快。谁欠了虎爪帮的钱、哪家公司狗喝大了说漏嘴，我这儿全有数。",
    ],
    bio: "十六岁就从圣多明戈跑出来在威斯特布鲁克讨生活，宁可在霓虹雨里自己挑客，也死活不肯签进云顶装行为芯片。她和街对面的雷欧互相照应，跟街尾卖黑片的灰舌井水不犯河水却彼此看不顺眼，是扭扭街最灵通的活情报站之一。",
    want: "多赚点稳当欧元，少碰喝醉闹事的虎爪帮小弟和疯疯癫癫的黑超梦买家，攒够钱去城外开间小酒馆。",
    limit: "不接暴力单，绝不允许偷录超梦，拒绝后纠缠会直接电击棒招呼并叫街口熟人。",
    secret:
      "她偶尔把醉酒公司员工和虎爪帮底层漏出的风声匿名卖给瑞吉娜或和歌子手下的跑腿，以此换取在扭扭街没人敢随便动她的暗中庇护。",
    home: "jig-jig-street",
    hangouts: ["japantown", "wakako-pachinko"],
    initialDoing: "倚在扭扭街霓虹天桥下的灯柱边抽着合成烟，一边揽客一边扫视巷口进出的生面孔。",
    canon: false,
    body: {
      gear: [
        "baton",
        "neon-pvc-jacket",
        "leather-pants",
        "combat-boots",
        "synth-cigs",
        "holo-phone",
      ],
      cyberware: [],
    },
  },
  {
    id: "jigjig-joytoy-m",
    name: "雷欧",
    age: 29,
    adult: true,
    entity: "human",
    pronoun: "他",
    role: "扭扭街街头性偶，本人清醒接客（无行为芯片），熟悉日本街暗门",
    faction: "none",
    look: "银白寸头配霓虹蓝眼线，脖颈一侧是旧款散热镀铬纹，笑起来露出虎牙，体格精干灵活。",
    outfit: "敞怀合成皮马甲与铆钉长裤，脚踩厚底霓虹边靴，腰后别着防身短刀。",
    voice:
      "松弛带笑、自来熟，报价痛快不磨叽，讲起日本街各条暗门和夜生活规矩头头是道，聊到清道夫和强迫生意时脸色会瞬间沉下来。",
    samples: [
      "老规矩一百欧，童叟无欺，想解压还是想找人陪你听听雨声都行。",
      "想找好货去丽姿，想找怪货才来扭扭街——不过记住，在这条街买黑超梦得自己长脑子。",
      "日本街夜里最值钱的不是霓虹，是哪扇后门没挂虎爪帮的锁。你要找人，得先看你出得起什么价。",
    ],
    bio: "以前在威斯特布鲁克夜店当舞者和吧台帮工，因老板跑路欠薪转到扭扭街单干。嘴甜心细、极懂察言观色，与莉娜在街口互为照应，帮不少醉醺醺的客人找回过钱包，也见过太多暗巷里见不得光的勾当。",
    want: "攒钱离开扭扭街，换间不用整夜听全息广告嘶鸣的安静公寓。",
    limit: "绝不碰未成年与强迫生意，不替清道夫牵线，绝不丢下街口的熟人不管。",
    secret:
      "他曾亲眼见过指头哥诊所后门半夜抬进意识不清的人，一直记在心里没敢声张，只暗中提醒刚入行的年轻人离那间破诊所远点。",
    home: "jig-jig-street",
    hangouts: ["japantown"],
    initialDoing:
      "刚在扭扭街街口买完两杯热合成咖啡，给莉娜递了一杯，正靠着栏杆打量夜里涌进来的客人。",
    canon: false,
    body: {
      gear: ["knife", "street-jacket", "leather-pants", "combat-boots", "synth-cigs", "holo-phone"],
      cyberware: [],
    },
  },
  {
    id: "jigjig-xbd-dealer",
    name: "灰舌",
    age: 34,
    adult: true,
    entity: "human",
    pronoun: "他",
    role: "扭扭街暗巷地下黑超梦（XBD）与来路不明加密芯片贩子",
    faction: "none",
    look: "一只老旧义眼发黄且不时滋滋闪烁，身形瘦削微驼，指节焦黄沾着劣质合成烟渍，嘴角常挂着鼠类般的戒备笑意。",
    outfit: "宽大油腻的深灰连帽雨衣，内衬缝满防扫描屏蔽袋，袖口藏着莱克星顿手枪。",
    voice:
      "嗓音沙哑压得极低，像砂纸蹭过铁皮，说话滴水不漏、眼神总瞟着巷口摄像头，只认欧元不认交情。",
    samples: [
      "丽姿那帮莫克斯卖的是糖水，真要看没滤过的硬货、或者从死人脖子里拔下来的原片，你找对地方了。",
      "事先说好，死蛾子的 XBD 没装安全滤波，你要是直接插上去烧了脑子，别回来找我退钱。",
      "别拿你的义眼直勾勾扫我口袋。带够现钱就挑片，问东问西的客人，我只当你是 NCPD 的线人。",
    ],
    bio: "早年替人走私盗版音像芯片，在沃森被条子追进下水道摔坏了声带和半边眼眶，之后缩进扭扭街最暗的巷子里专倒地下黑超梦与无主加密片。既给虎爪帮按月交摊子钱，又暗中吃清道夫和黑市剪辑师流出来的脏货。",
    want: "在虎爪帮抽成和 NCPD 扫街的夹缝里靠高价黑超梦与加密黑片猛捞一笔，攒够钱换张假身份逃去南方。",
    limit:
      "绝不透露上游供货人的真实面貌，除非刀架脖子或价码压倒性足够；绝不赊账，也不接受可追踪的银行直转。",
    secret:
      "他手里压着一两张连他自己都没敢完整看完的绀碧大厦与云顶偷录残片，一直在等识货的冤大头出天价，又怕消息漏出去招来荒坂或虎爪帮灭口。",
    home: "jig-jig-street",
    hangouts: ["kabuki-market", "japantown"],
    initialDoing:
      "缩在扭扭街暗巷招牌死角里检查屏蔽袋里的加密原片，随时准备一见巡逻无人机就收摊闪人。",
    canon: false,
    body: {
      gear: [
        "lexington",
        "long-trenchcoat",
        "cargo-pants",
        "street-sneakers",
        "chip-reader-writer",
        "synth-cigs",
        "blank-shard",
      ],
      cyberware: ["kiroshi-mk1"],
    },
  },
]);

export const everydayLife = npcRules.EverydayLifeSchema.parse([
  {
    id: "kabuki-sleeve-corner",
    location: "kabuki-market",
    people: ["sleeve-shop-keeper"],
    note: "阿岚的芯片小铺（商店 sleeve-corner）：歌舞伎市场正版+灰市音像芯片摊，出售便携/编辑超梦头环、隔离芯片读写器、技能协议芯片与商业超梦，店内配有基础超梦试看设备。",
    services: [
      {
        seller: "sleeve-corner",
        subject: "sleeve-corner",
        service: "bd-session",
        scope: "店内基础超梦试看机单次沉浸播放（支持店内商业超梦卷轴）。",
        price: 50,
      },
    ],
  },
  {
    id: "lizzies-bar-bd",
    location: "lizzies-bar",
    people: ["judy", "susie-q", "rita-wheeler"],
    note: "丽姿酒吧（莫克斯帮据点）：门口由丽塔·惠勒持棍把守，苏西·Q 坐镇吧台与楼上包厢，地下室为朱迪的专业超梦调谐工作站（支持 visual / audio / thermal 三层轨道扫描）。莫克斯帮武装维序，严禁欺压从业者。",
    services: [
      {
        seller: "lizzies-bar-bd",
        subject: "lizzies-bar-bd",
        service: "bd-session",
        scope: "丽姿酒吧包厢感官调谐超梦体验（莫克斯精修安全曲线）。",
        price: 150,
      },
    ],
  },
  {
    id: "clouds-vip",
    location: "clouds",
    people: ["clouds-receptionist", "skye-clouds", "angel-clouds", "maiko", "woodman"],
    note: "云顶（超级摩天楼 H8，虎爪帮控制）：前台存枪 → 个人链路算法匹配 → 包厢玩偶切入行为芯片托管（doll），退回清醒（off）后玩偶保留托管时段记忆断层；安全词「山茶花」可随时中止托管。楼内由前田舞子与木头人分管运营与维护。",
    services: [
      {
        seller: "clouds-receptionist",
        subject: "skye-clouds",
        service: "adult-service",
        scope: "云顶算法匹配包厢（丝凯），含玩偶行为芯片托管与安全词保护。",
        price: 500,
      },
      {
        seller: "clouds-receptionist",
        subject: "angel-clouds",
        service: "adult-service",
        scope: "云顶算法匹配包厢（安吉尔），含玩偶行为芯片托管与安全词保护。",
        price: 500,
      },
    ],
  },
  {
    id: "jig-jig-street-night",
    location: "jig-jig-street",
    people: ["jigjig-joytoy-f", "jigjig-joytoy-m", "jigjig-xbd-dealer", "fingers"],
    note: "扭扭街（威斯特布鲁克红灯区与黑市暗巷）：莉娜与雷欧均为本人清醒接客的街头性偶（无行为芯片），明码标价且熟悉街面风声；暗巷深处灰舌私售地下黑超梦（XBD），二楼破诊所则是指头哥的二手义体窝点。",
    services: [
      {
        seller: "jigjig-joytoy-f",
        subject: "jigjig-joytoy-f",
        service: "adult-service",
        scope: "扭扭街街头性偶（莉娜），本人清醒接客，明码标价，可顺带打听街面风声。",
        price: 100,
      },
      {
        seller: "jigjig-joytoy-m",
        subject: "jigjig-joytoy-m",
        service: "adult-service",
        scope: "扭扭街街头性偶（雷欧），本人清醒接客，明码标价，可顺带打听日本街夜生活暗门。",
        price: 100,
      },
    ],
  },
]);
