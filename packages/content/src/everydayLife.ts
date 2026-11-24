import { npcRules } from "@cp/core";

/**
 * 夜之城神经接口与红灯区三层生态原作常驻人物（2077-04-12 校准）：
 * 1. 歌舞伎市场：洋子·鹤（Yoko Tsuru，环状市场黑客与芯片小铺店主，T-Bug 同行）
 * 2. 丽姿酒吧：莫克斯武装维序与感官超梦会所（朱迪、苏西·Q、丽塔在 npcs.ts）
 * 3. 云顶（H8）：切丽·诺林（前台安检与算法匹配）+ 玩偶丝凯/安吉尔（植入 doll-behavior-chip；舞子、木头人在 npcs.ts）
 * 4. 扭扭街：兰尼·尼罗（Lenny Nero，暗巷黑超梦 XBD 贩子）+ 指头哥（在 npcsExtra.ts），街头另有一男一女无名清醒性偶
 */
export const everydayPeople = npcRules.NpcCardSchema.array().parse([
  {
    id: "yoko-tsuru",
    name: "洋子·鹤",
    alias: "洋子",
    age: 34,
    adult: true,
    entity: "human",
    pronoun: "她",
    role: "歌舞伎市场黑客与芯片小铺店主，专营快速破解程序、技能芯片与超梦器材",
    faction: "none",
    circle: "service",
    look: "齐耳深黑短发带精致挑染，眉眼清冷敏锐，耳后与锁骨间嵌有整洁的日系神经接口，神态总透着老练网行者的克制与审视。",
    outfit: "深色极简机能夹克配高领内搭，柜台终端常年连着多重跳板隔离读写阵。",
    voice:
      "吐字干脆冷静、带点网行者圈子里的专业疏离感；面对生客公事公办、不喜废话，对 T-Bug 介绍来或真正懂协议的同行才会多提点两句。",
    samples: [
      "快速破解芯片和正版超梦器材都在柜台列表里；来路不明的加密片插脖子前，最好先过一遍隔离读写器。",
      "T-Bug 跟我提过一嘴，最近沃森这片网段不太平。挑好程序就刷钱，别在店里拖着不走。",
      "破解固件不是街头玩具——没有匹配的接入仓算力和破冰手法，再贵的芯片到了你手里也只是块废硅片。",
    ],
    bio: "坐镇歌舞伎市场环状商业街的黑客装备与芯片店主，在沃森网行者圈子里口碑极稳，与 T-Bug 是多年老同行。明面上卖商业超梦、技能协议芯片与常规快速破解程序，暗地里也帮信得过的独立黑客过筛加密残片、提供干净跳板，始终与帮派保持分寸距离。",
    want: "守住歌舞伎市场这间干干净净的黑客芯片小铺，在公司监控与帮派眼皮底下安稳做懂行人的生意。",
    limit:
      "绝不碰清道夫出品的无滤波血腥 XBD，不替客人担保未验毒黑片的安全性，也不会把熟客的交易记录卖给虎爪帮或网监。",
    secret:
      "她私下和包括 T-Bug 在内的几名老牌独立黑客共享着一张沃森本地子网监控盲区图，柜台底层加密盘里还留着几段从公司报废终端截出来的旧协议模板。",
    home: "kabuki-market",
    hangouts: ["lizzies-bar", "tom-diner"],
    initialDoing:
      "在歌舞伎市场环状二层的芯片小铺柜台后核验一批新到的快速破解固件，顺手给隔离终端刷新防追踪跳板。",
    canon: true,
    body: {
      gear: [
        "yukimura",
        "street-jacket",
        "turtleneck-knit",
        "cargo-pants",
        "street-sneakers",
        "chip-reader-writer",
        "blank-shard",
        "holo-phone",
      ],
      cyberware: ["kiroshi-mk2", "fuyutsuki-deck", "self-ice", "smart-link"],
    },
  },
  {
    id: "cheri-nowlin",
    name: "切丽·诺林",
    alias: "切丽",
    age: 29,
    adult: true,
    entity: "human",
    pronoun: "她",
    role: "超级摩天楼 H8 云顶俱乐部前台接待员，负责存枪安检与个人链路算法匹配",
    faction: "tyger-claws",
    circle: "gang",
    look: "紫红挑染利落短发配精致艳丽的全息妆容，眼周嵌着浅色镀铬饰线，站在全息接待台后始终挂着标准化的职业微笑。",
    outfit: "暗色与霓虹粉拼接的云顶制式修身接待裙与高跟鞋，耳麦直连虎爪帮安保频道。",
    voice:
      "礼貌轻柔、带着标准化的高端会所接待腔，滴水不漏；一涉及武器寄存、贵宾禁区或查问后台人员，语气立刻收紧透出不容通融的戒备。",
    samples: [
      "欢迎来到云顶。入场前请先将所有枪械与利器寄存进安保柜，再接入个人链路进行神经算法匹配。",
      "系统已为您匹配最契合潜意识需求的玩偶。请牢记安全词「山茶花」，任何时刻念出即可中止托管。",
      "抱歉，贵宾通道与维护层仅限授权人员进入。您在云顶只需要享受匹配好的包厢，多余的事别打听。",
    ],
    bio: "超级摩天楼 H8 云顶俱乐部的常驻前台接待员，负责查验入场费、强制存枪安检与操作个人链路神经网络匹配终端。常年在虎爪帮势力、前田舞子与木头人的夹缝里讨生活，深谙在云顶少问多干、按流程办事才是保命铁律。",
    want: "安稳走完每一班接待与安检流程不出纰漏，既不得罪难缠的贵宾，也不让舞子和木头人拿自己当出气筒。",
    limit: "绝不允许客人带枪闯入包厢区，绝不当面泄露贵宾名单、包厢监控规律或维护层后台位置。",
    secret:
      "她每天经手所有客人的入场记录与匹配日志，心里比谁都清楚云顶最近有玩偶异常离岗，也察觉到舞子和木头人之间剑拔弩张，只敢埋头装糊涂保平安。",
    home: "clouds",
    hangouts: ["japantown"],
    initialDoing: "站在云顶前台全息操作台后核对今晚的预约流水，同时留意安保频道里的电梯层通报。",
    canon: true,
    body: {
      gear: ["club-dress", "dress-shoes", "holo-phone", "shard-intel-clouds-manual"],
      cyberware: ["kiroshi-mk1", "self-ice"],
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
    circle: "gang",
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
    circle: "gang",
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
    id: "lenny-nero",
    name: "兰尼·尼罗",
    alias: "兰尼",
    age: 37,
    adult: true,
    entity: "human",
    pronoun: "他",
    role: "扭扭街暗巷黑超梦（XBD）与违禁加密芯片贩子",
    faction: "none",
    circle: "service",
    look: "瘦削油滑的街头男贩子，黑发微乱、神情总透着亢奋又神经质的精明，眼角挂着常年混迹暗巷的阴影，手里总把玩着几张无标签黑片。",
    outfit: "暗色长风衣内搭花哨街头衬衫与工装裤，内衬口袋塞满屏蔽芯片盒，暗处藏着防身手枪。",
    voice:
      "语速滑溜、推销时带着地下掮客特有的神秘兮兮和诱惑腔；一旦涉及清道夫上游源头或被拿枪顶着，立刻变脸讨饶、满嘴推卸责任。",
    samples: [
      "嘘——小点声。丽姿那帮莫克斯卖的都是过滤过的糖水，真想看原汁原味、没削过感官的 XBD，全扭扭街只有我兰尼手里有货。",
      "“死神之首”那种硬货可不便宜，出了这巷口插进你脑子里烧成什么样，我可一概不管售后。",
      "别老打听片子是谁录的、从哪个地下室流出来的！付现钱拿片走人，想知道得太多在这条街活不过三天。",
    ],
    bio: "常年盘踞在日本街扭扭街暗巷里的知名地下黑超梦（XBD）贩子，专做无滤波违禁超梦、偷录原片与黑市加密芯片生意。既按规矩给虎爪帮交地盘费，又暗地里收清道夫「死神之首」一类血腥地下作坊流出的黑货，贪财怕死、见钱眼开。",
    want: "靠倒卖稀缺违禁黑超梦和来路不明的加密原片大捞一笔，同时别让 NCPD 或找上门的狠角色把自己掀了。",
    limit: "只收现钱绝不赊账；真被逼到枪口底下宁可出卖渠道自保，也绝不替上游清道夫扛命。",
    secret:
      "他私下接过清道夫「死神之首」黑超梦作坊流出的几批血腥原片，并偷偷压着一两张带云顶与高端场所偷录片段的稀缺黑片，等肯出高价的买家上门。",
    home: "jig-jig-street",
    hangouts: ["japantown", "kabuki-market"],
    initialDoing:
      "靠在扭扭街暗巷招牌下的阴影里清点刚收进来的几张无标黑超梦芯片，一边四处张望一边招呼懂行的熟客。",
    canon: true,
    body: {
      gear: [
        "lexington",
        "long-trenchcoat",
        "silk-shirt",
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
    people: ["yoko-tsuru"],
    note: "洋子的黑客芯片铺（商店 sleeve-corner，店主洋子·鹤）：歌舞伎市场环状商业街著名黑客与音像芯片小铺，出售快速破解程序、便携/编辑超梦头环、隔离芯片读写器、技能协议芯片与商业超梦，店内配有基础超梦试看设备。",
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
    people: ["cheri-nowlin", "skye-clouds", "angel-clouds", "maiko", "woodman"],
    note: "云顶（超级摩天楼 H8，虎爪帮控制）：前台切丽·诺林负责存枪与个人链路算法匹配 → 包厢玩偶丝凯/安吉尔切入行为芯片托管（doll），退回清醒（off）后玩偶保留托管时段记忆断层；安全词「山茶花」可随时中止托管。楼内由前田舞子与木头人分管运营与维护。",
    services: [
      {
        seller: "cheri-nowlin",
        subject: "skye-clouds",
        service: "adult-service",
        scope: "云顶算法匹配包厢（丝凯），含玩偶行为芯片托管与安全词保护。",
        price: 500,
      },
      {
        seller: "cheri-nowlin",
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
    people: ["lenny-nero", "fingers"],
    note: "扭扭街（威斯特布鲁克红灯区与黑市暗巷）：街口常驻一女一男两位清醒接客的无名街头性偶（无行为芯片，明码标价 100 欧；仅在玩家实际搭话消费时按原作当场以普通称呼建成年在场人物卡并走 trade 的 adult-service 结算，不编造花哨身世）；暗巷深处兰尼·尼罗私售地下黑超梦（XBD）；二楼破诊所则是指头哥的二手义体窝点。",
    services: [],
  },
]);
