import { inventoryRules, shardsRules } from "@cp/core";

/** 本文件的作者、刊物、录音及正文均为本作原创，不作为《赛博朋克》官方设定资料。 */
type ChipSeed = Omit<shardsRules.ChipContent, "id" | "requirements"> & {
  slug: string;
  price: number;
  rarity: "common" | "uncommon";
  requirements?: string[];
};

const chipSeeds: ChipSeed[] = [
  {
    slug: "kabuki-morning-radio",
    price: 25,
    rarity: "common",
    title: "歌舞伎早六点",
    kind: "recording",
    from: "摊贩电台阿簌／录制者授权发行",
    purpose: "media",
    summary: "一段完整的市场晨间广播，收着开摊通知、点歌与一则招工。",
    parts: [
      {
        id: "opening",
        label: "早班开场录音",
        text: "早六点，今天的卷帘门比赛还是老钟第一名。东侧公共水龙头已经修好，接水的别把鱼箱排在咖啡桶前头。找临时搬运的阿朵说，工钱当班结，午饭给两份；她只要两个能准时来的人，别再派个扩音器替你答应。接下来这首《最后一班货车》送给还没睡的和刚睡醒的。",
      },
      {
        id: "request",
        label: "一条没有删掉的点播",
        text: "插播一条点歌：给卖袜子的芬姐，昨天欠你的十一块已经夹在蓝色收据本里。芬姐在隔壁喊，钱找着了，歌留着播。主播笑了一阵，麦克风碰到杯沿。录音结尾有人开始试油温，电台没再说话，只把那首歌放完了。",
      },
    ],
    related: ["kabuki-market"],
  },
  {
    slug: "stall-supper-cookbook",
    price: 30,
    rarity: "common",
    title: "收摊锅里还有什么",
    kind: "data",
    from: "黄碗夜食摊小路",
    purpose: "data",
    summary: "摊主写给做夜班饭的人：一口锅、少量食材与能再热的晚餐。",
    parts: [
      {
        id: "rice",
        label: "脆边剩饭",
        text: "冷藏的熟饭先拨散，锅底只留薄薄一层油。便宜蛋白块切得比葱小，煎出边角再下饭，别一着急就全倒进去。酱汁最后沿锅边加，能少洗一个碗。想留明天一份，就在拌酱前分出去；别让第二顿从今晚的盘底开始。",
      },
      {
        id: "broth",
        label: "摊主自己的那碗",
        text: "小路在配方末尾写：客人的汤要清，我自己的汤要稠。把切下来的菇柄和菜叶另装一盒，当天熬掉，撒一小撮酸椒粉就很像一顿认真做的饭。隔壁总来借葱，后来每周送一袋面包边；压进汤里时，记得留两片脆的在上面。",
      },
    ],
    related: ["kabuki-market"],
  },
  {
    slug: "stall-account-book",
    price: 20,
    rarity: "common",
    title: "小摊账本留一格",
    kind: "data",
    from: "歌舞伎摊主合编／阿朵整理",
    purpose: "data",
    summary: "微型摊位的交班、订货和零钱记账范本，附着整理者的真实用法。",
    parts: [
      {
        id: "closing",
        label: "交班页",
        text: "每天只填四列：今日实收、今日支出、抽屉零钱、已经答应却还没付的钱。押箱费不算卖货收入，给熟客留的货另记数量。表格底下留一格写明天的事，越具体越好：周三九点退两个红筐，比写个退货有用。交班的人核过抽屉，就在同一行签名。",
      },
      {
        id: "margin",
        label: "账边的小字",
        text: "阿朵把一笔招待费圈了起来：那天停电，六家摊一起吃掉的冰品，别算到值班姑娘的损耗里。还有一行写着给搬运工留饭，旁边补了三个字，不扣钱。这份空表可以反复复制，样例数字都标在浅色栏，开自己的账时先清空。",
      },
    ],
    related: ["kabuki-market"],
  },
  {
    slug: "h10-laundry-book",
    price: 15,
    rarity: "common",
    title: "H10洗衣房值班簿",
    kind: "diary",
    from: "H10住户米蕾／节选授权",
    purpose: "data",
    summary: "洗衣房小黑板的公开抄本，记着共用机器、遗失衣物和轮班人的日子。",
    parts: [
      {
        id: "machines",
        label: "贴在三号机上",
        text: "三号机要把门往上托一点再关，别踹。二号机的快洗其实比普通洗只快四分钟，省下来的水却会留在厚外套里。请来取衣服的人也看一下清洁滤网那格；一个人清了不代表这个月都归他清。柜台有细网袋，可以借，写房号就好。",
      },
      {
        id: "socks",
        label: "没人认领的袜子",
        text: "失物箱的红围巾被领走了，主人请大家喝了一轮自动机热饮。那只印着月亮的袜子还在，我洗干净挂回去了。今夜轮到我上班，谁看见烘干结束，帮我把衣服移进篮子，别叠；有人替我叠得太好，我回家会舍不得穿。",
      },
    ],
    related: ["megabuilding-h10"],
  },
  {
    slug: "h10-balcony-garden",
    price: 25,
    rarity: "common",
    title: "窗台上种一点绿",
    kind: "data",
    from: "H10花箱小组／米蕾与阿文",
    purpose: "data",
    summary: "小空间香草和耐阴盆栽记录，包含每周照料表与一次失败的尝试。",
    parts: [
      {
        id: "window",
        label: "先看窗，再买苗",
        text: "把一张纸放在窗边，早中晚各画一次亮处的位置。有的窗户看着亮，整天只借了隔壁广告牌的光。薄荷放靠外那排，老叶留着煮水；背阴的位置先试绿萝，别一上来就买满柜。浇水前摸土下两节指深，表面干不代表底下也干。",
      },
      {
        id: "roster",
        label: "轮值栏",
        text: "周一到周五谁早回家谁打勾，打过勾就别再浇。上个月那盆罗勒不是死于没人管，是五个人都怕它渴。阿文画了一只鼓起肚子的花盆，贴在水壶上。这个月第一把剪下来的叶子分给做三明治的住户，换回来六份早餐。",
      },
    ],
    related: ["megabuilding-h10"],
  },
  {
    slug: "h10-rental-checklist",
    price: 20,
    rarity: "common",
    title: "搬进来那天先留一份",
    kind: "data",
    from: "H10住户互助桌／公开整理稿",
    purpose: "data",
    summary: "夜之城租住生活的原创交接单样本，帮助整理钥匙、账目和报修记录。",
    parts: [
      {
        id: "handover",
        label: "入住交接单样本",
        text: "样本先列钥匙数量、房内固定设备、能源读数和已经存在的破损。每项给一处日期、一张照片的位置和双方确认栏。公共走廊的照明另记为公共设施，别混进房内清单。租金、押金和门禁卡费用分开填；口头说会退的钱，也留一栏写清退还条件。",
      },
      {
        id: "repairs",
        label: "报修之后",
        text: "有人问留这些是不是为了和人吵架。整理者答：上次维修员换班，后来的人不知道墙里走过水管，我们又让出一整天等他重查。把来过谁、换了什么、还有哪一步没做完写下来，下个人就能接着干。退租时也把双方已经确认的结算各留一份。",
      },
    ],
    related: ["megabuilding-h10"],
  },
  {
    slug: "japantown-b-side",
    price: 45,
    rarity: "uncommon",
    title: "倒数第二班车·B面",
    kind: "recording",
    from: "回声斜巷二人组／乐手授权发行",
    purpose: "media",
    summary: "十八分钟原创合成器与手鼓小样，附两段乐手写给听众的短话。",
    parts: [
      {
        id: "tracks",
        label: "B面曲目与录音",
        text: "第一首《楼梯间的低音》把排风机的拍子留在了底下；第二首《换乘时别挂断》由四段很短的旋律接成；最后一首叫《你先坐》。录音里手鼓有两处抢拍，合成器手都追上去了。两人说删掉失误也能发行，只是那就听不出他们那晚为什么一直笑。",
      },
      {
        id: "liner",
        label: "封底给买碟的人",
        text: "我们在地铁外摆过摊，也给空得能听见制冰机的酒吧演过。买这张不必证明你认识什么地下流派，坐车、擦桌子、等朋友时都能放。要是你喜欢第二首，告诉旁边的人就行。下一张还没录好，别替我们约演出，鼓手周二还要值夜班。",
      },
    ],
    related: ["japantown"],
  },
  {
    slug: "afterhours-adult-review",
    price: 40,
    rarity: "common",
    title: "半掩门·成年生活别册",
    kind: "data",
    from: "半掩门成年作者编辑组／作者及出镜者授权",
    purpose: "media",
    summary: "面向成年读者的身体、工作与亲密关系杂志，含访谈和非露骨摄影随文。",
    parts: [
      {
        id: "portrait",
        label: "卸妆后还有半杯茶",
        text: "本期受访者都是成年人。一位舞者把演出服挂在浴室门后，穿旧运动裤给采访者煮茶。她说舞台上每一分钟都排练过，回家最喜欢的事却是没人等她说下一句。她选入刊物的照片拍在排练室，镜子里有人替另一人整理衣领，旁边摊着晚饭的纸袋。",
      },
      {
        id: "column",
        label: "不必把每次约会过成答案",
        text: "专栏写一对成年伴侣重新安排作息：周末各留半天独处，回家前问一句要不要带吃的。第一次照做时，他们都等着对方失望，后来发现那晚的话反而更多。作者把亲密写成可以慢慢商量的生活，连谁睡靠窗那边也值得说清。末页附了编辑们各自喜欢的夜宵。",
      },
    ],
    related: ["japantown"],
  },
  {
    slug: "stage-wardrobe-guide",
    price: 35,
    rarity: "common",
    title: "小舞台衣箱急救簿",
    kind: "data",
    from: "服装师阿茉／自印第三版",
    purpose: "data",
    summary: "酒吧与街头小演出的服装维护手册，侧重快换、收纳和有限工具。",
    parts: [
      {
        id: "kit",
        label: "衣箱第一层",
        text: "黑白线各一卷，圆头针、别针、可移除布胶、细剪和一块干净的布。亮片衣先套袋再放箱，鞋跟另外包，别靠整箱香水盖住潮气。需要快换的扣子做明显记号，人在暗处找扣眼时没有平时灵巧。演出前让穿的人自己走一遍，蹲一下，抬一次手。",
      },
      {
        id: "aftershow",
        label: "散场的十分钟",
        text: "先把衣服摊开，再收电线；汗还没散就塞回箱，第二天是谁都不想接手的活。阿茉在每个衣袋里放一张小卡，写穿衣人的名字和他不喜欢哪里勒。修好后把卡翻面，不要每次都问一遍。同一件外套穿三年，也该像第一场那样合身。",
      },
    ],
    related: ["japantown", "lizzies-bar"],
  },
  {
    slug: "counter-phrase-assist",
    price: 85,
    rarity: "uncommon",
    title: "柜台短句检索组件",
    kind: "data",
    from: "桥口语言工作室／原创服务短句库",
    purpose: "function",
    summary: "在读写器上按场景检索固定多语短句、读音和文字卡，用于有限柜台沟通。",
    parts: [
      {
        id: "operation",
        label: "先选要做的事",
        text: "菜单分为点餐、取件、问价和约定时间，每条短句都有原文、释义、可点读音和给对方看的大字页。数量、日期与金额要由使用者逐项填入。对方说得更复杂时，可以调出请写下来这一页，再凭实际写下的文字查内置词条；词库不会补出没听懂的部分。",
      },
      {
        id: "example",
        label: "一份取件演示",
        text: "演示先展示我来取修好的外套，再单独展示取件号四一七。柜员指向三点以后，使用者将时间填进确认页给她看。短句设计者说，把一句话拆成两张卡有时比一次播放十秒更好用。组件保留本次填好的卡片，办完事后可由使用者清空。",
      },
    ],
    requirements: ["chip-reader-writer"],
    ability:
      "通过实际持有的读写器检索内置点餐、取件、问价、约时短句，显示或点读选中的表达，并整理使用者输入的数字；只辅助现场有限沟通，不自动听译完整对话，也不使使用者永久掌握语言。",
    related: ["japantown", "kabuki-market"],
  },
  {
    slug: "cojo-open-mic",
    price: 35,
    rarity: "common",
    title: "开麦之夜，桌子没坐满",
    kind: "recording",
    from: "后院开麦小组／表演者授权现场集",
    purpose: "media",
    summary: "二十六分钟原创歌曲、短诗和场间闲聊，保留小场子的完整起落。",
    parts: [
      {
        id: "set",
        label: "当晚节目",
        text: "开场的吉他手先找了半分钟调音夹，第三排有人举起一个，他说谢谢，但那是开瓶器。接着唱的是《今天领薪》，一首把房租、早餐和一双新鞋排进同一段副歌的歌。第二位读了一首写给修车姐姐的短诗，末句读错，又从头来了一次。",
      },
      {
        id: "closing",
        label: "最后一张桌子",
        text: "最后一段只有合唱和椅子挪动的声音。组织者说，桌子没坐满也算演完了，下周照常。有人问能不能把录音带给值班的同事，所有表演者当场答应了这一版。收音机靠着吧台，末尾多录进一句明天谁来还麦架，答案是我，别催。",
      },
    ],
    related: ["coyote-cojo"],
  },
  {
    slug: "courtyard-recipes",
    price: 30,
    rarity: "common",
    title: "后院长桌合菜簿",
    kind: "data",
    from: "后院长桌住户会／伊赛拉整理",
    purpose: "data",
    summary: "按人数伸缩的家常合菜与带菜分工，记着一群人怎样吃到同一张桌上。",
    parts: [
      {
        id: "beans",
        label: "八人份豆锅",
        text: "豆子提前泡好，洋葱炒软后再添番茄和水。八人份不是把一个人的辣椒乘八，先做温和的底，辣酱单放桌上。带面饼的人顺手带块干布，捂着比一层层包塑料袋好。菜上桌前留一份没碰过餐具的，给晚到的夜班人。",
      },
      {
        id: "table",
        label: "谁带什么",
        text: "名单原来写了五个人带肉，没人带盘子。伊赛拉重新画成主菜、素菜、主食、饮水、餐具五栏，最后加一栏叫人来就行。那一栏总有人不好意思签，她就在自己名字旁也打了勾。洗锅的人可以把剩菜先装，桌布由下次最早到的人领走洗。",
      },
    ],
    related: ["coyote-cojo"],
  },
  {
    slug: "second-shift-letters",
    price: 40,
    rarity: "common",
    title: "我们总在错班·通信选",
    kind: "email",
    from: "成年作者南与维／双方授权文学选编",
    purpose: "media",
    summary: "两位成年伴侣将轮班生活改写成的通信作品，写思念，也写冰箱和坏闹钟。",
    parts: [
      {
        id: "night",
        label: "凌晨的一封",
        text: "我到家时你留的汤已经结了一层薄皮，说明你至少提前半小时想起我。今天的灯箱又闪了，我没修，先坐下来把汤喝完。你上回问我周日想去哪儿，我想把两个人的闹钟都关掉，醒了再决定。要是你还是想出门，别等我说漂亮话，直接把外套扔过来。",
      },
      {
        id: "morning",
        label: "早班的回信",
        text: "看到了。外套放椅背，冰箱贴后面留了去海边的钱，不过我们也可以只下楼吃饭。你不用因为我早睡就把屋里每样东西都摆回原位，杯子留在桌上，我才知道你确实回来过。周日我负责关闹钟，你负责想起来以后别习惯性打开工作消息。",
      },
    ],
    related: ["coyote-cojo", "megabuilding-h10"],
  },
  {
    slug: "counter-paperwork-guide",
    price: 35,
    rarity: "common",
    title: "柜台前把单子填完",
    kind: "data",
    from: "跑单员路易／夜之城生活样本集",
    purpose: "data",
    summary: "本作虚构委托、寄存与短期服务的文书练习本，附回执整理方法。",
    parts: [
      {
        id: "service",
        label: "短期服务确认单样本",
        text: "示例委托是替一间办公室送三箱档案。表上分开写起点、交付对象、箱数、时限、报酬和另付费用，再给临时改地址留一个确认栏。收到货的人签在交付格，不让门口帮忙开门的人代签。样本把空白委托与填好的练习页放在不同目录，抄用时一眼能分清。",
      },
      {
        id: "receipt",
        label: "回执怎么找得回来",
        text: "路易按日期、对方名称和办事内容给回执命名，不用最终版、最新这一类文件名。付过款的单子记上对应流水，寄存凭条同时记取回期限。页脚写着一次教训：他没有丢掉收据，只是在十七个叫新文件的目录里找了四十分钟，回来时午饭窗口已经关了。",
      },
    ],
    related: ["corpo-plaza"],
  },
  {
    slug: "office-exit-zine",
    price: 30,
    rarity: "common",
    title: "电梯向下·午休小刊",
    kind: "diary",
    from: "电梯向下匿名笔名编辑组／作者授权",
    purpose: "media",
    summary: "大楼打工人自印的微型散文集，写通勤、带饭与没那么体面的休息。",
    parts: [
      {
        id: "lunch",
        label: "带饭者席位",
        text: "公司大厅的长椅很软，午饭时间却没地方放饭盒。我们试过窗边、楼梯和一台坏掉的售货机前，最后找到地下一层的矮窗台。风从车道吹进来，米饭很快就凉，可那里允许一个人吃完饭还不站起来。后来多了两张折叠凳，没人承认是谁买的。",
      },
      {
        id: "elevator",
        label: "今天不用等我",
        text: "同事总在电梯口说等你，直到有一天我告诉她今天还有很多事，你先下去吧。她点头，第二天照旧等我。小刊编辑把这段留下来，说不必给它补一个辞职或和解的结尾。整本最后一页只有晚班穿梭车的候车习惯：两人排队，留个口子，让推清洁车的人先过。",
      },
    ],
    related: ["corpo-plaza"],
  },
  {
    slug: "coast-screening-notes",
    price: 25,
    rarity: "common",
    title: "海风放映会节目单",
    kind: "data",
    from: "海风放映小组／原创短片与编者随笔",
    purpose: "media",
    summary: "三部原创社区短片的授权文字随刊，收着剧情、映后讨论与场地杂记。",
    parts: [
      {
        id: "program",
        label: "本周三部短片",
        text: "《折叠椅》拍一个人替街坊保管椅子，直到他的房间只剩一条走路的缝；《停在这里》跟着早餐车走完一天，却始终不拍老板的脸；《第二扇窗》是住户们分别画出窗外再拼起来的动画。文字随刊保留了导演授权的完整梗概，影像本体不在这张资料芯片里。",
      },
      {
        id: "afterwards",
        label: "映后没有主持人",
        text: "投影收起来以后大家还在谈那张椅子该不该送走。卖饮料的人觉得该，替街坊搬东西的人觉得不该，导演坐在后排听，没宣布哪个答案才对。场地杂记写：下次把幕布下沿绑紧，风一来，所有人物都会像坐船。多备两条延长线和一卷纸巾。",
      },
    ],
    related: ["grand-imperial-mall"],
  },
  {
    slug: "umbrella-repair-book",
    price: 20,
    rarity: "common",
    title: "雨棚与旧伞还能用",
    kind: "data",
    from: "海岸补伞摊阿蓓",
    purpose: "data",
    summary: "旧雨具和摊位篷布的小修手册，附选料、收伞与借伞记录。",
    parts: [
      {
        id: "patch",
        label: "补片先剪圆角",
        text: "小破口先擦净晾干，补片比破处向外多留一圈，四角剪圆才不容易从边上掀起。伞骨铰点松了先看铆钉，别把整根用胶粘死，收伞时还要活动。摊棚的水要从低边排出去，不能只把破洞补上，却让下一场雨全积在正中。",
      },
      {
        id: "loan",
        label: "借出去的蓝伞",
        text: "阿蓓的借伞表只记颜色、借用日和对方愿意留下的称呼。有一把蓝伞每次回来都会多一截颜色不同的补线，已经认不出最早的针脚。她把它画在手册最后，说线不用配成同色，能看清旧补处，下回才知道该从哪里下针。",
      },
    ],
    related: ["grand-imperial-mall", "japantown"],
  },
  {
    slug: "reuse-parts-catalog",
    price: 30,
    rarity: "common",
    title: "旧件柜抽屉索引",
    kind: "data",
    from: "狗镇旧件摊索玛／公开选购册",
    purpose: "data",
    summary: "常见线缆、扣件与小电机的人工辨认资料，写清尺寸和能否替换。",
    parts: [
      {
        id: "labels",
        label: "抽屉标签怎么读",
        text: "每种旧件先看实际尺寸、额定标记和接口形状，再看来源机型。名字一样的两批货也可能差半毫米，带旧样来比最省事。索引把已量过和只凭包装辨认的分成两栏，缺的数据留空。小电机的转向与轴径单列，别因为外壳正好塞得进就算配好了。",
      },
      {
        id: "counter",
        label: "索玛的柜台话",
        text: "你要一枚垫圈，我不会让你买一整只泵；你要一只完整的泵，也别带着这份册子问能不能靠垫圈拼一台。索玛在目录末尾画了各层抽屉的位置，最下面写借尺归还处。透明罐里装试配后没用上的螺丝，客人可以拿合适的，也可以把自己多出来的放进去。",
      },
    ],
    related: ["dogtown"],
  },
  {
    slug: "water-pump-assist",
    price: 130,
    rarity: "uncommon",
    title: "小型水泵排查辅助",
    kind: "data",
    from: "索玛与合用水箱维护组",
    purpose: "function",
    summary: "按铭牌、人工观察和仪表读数查阅固定泵型图纸及排查步骤。",
    parts: [
      {
        id: "input",
        label: "从水箱那一端开始",
        text: "在读写器上选铭牌对应的泵型，再填水位、阀门位置和实际取得的供电读数。程序先显示进水管、滤网和止回阀的位置，让操作者逐项确认；同一台泵在空水箱和堵滤网时可能发出相似的声音，不能只听一声就下结论。没有对应型号时可翻通用部件图。",
      },
      {
        id: "log",
        label: "交班记录页",
        text: "每确认一项就留一行记录：看见了什么，测了什么，谁动过哪只阀。维护组用一例旧记录演示，最后发现是水箱浮子卡住，泵并没有坏。修复由现场人员完成，记录页把停水时间和重新供水时间分开，方便后来的人知道这次到底处理了多久。",
      },
    ],
    requirements: ["chip-reader-writer"],
    ability:
      "在实际读写器上依据输入的铭牌、水位、阀位和真实仪表读数，调用收录泵型的部件图与分支排查单，记录已经完成的现场检查；芯片不充当传感器，不自动控制阀门、维修水泵或提供零件。",
    related: ["dogtown", "badlands"],
  },
  {
    slug: "used-car-check-assist",
    price: 140,
    rarity: "uncommon",
    title: "旧车验看记录组件",
    kind: "data",
    from: "修车师奈德／车队自用工具发行版",
    purpose: "function",
    summary: "随车逐项记录证件、外观、冷车与路试观察，按已输入内容整理待确认事项。",
    parts: [
      {
        id: "walkaround",
        label: "绕车一圈再谈价",
        text: "读写器依次给出车身标识、轮胎、玻璃、底部渗漏和车内设备的检查栏。每项可以填观察结果、附上自己拍下的照片编号，也可以明确记为没检查。见到卖方报的型号就调对应尺寸表，身份文件和实车标识仍要由现场的人核对，不靠车漆颜色推断来路。",
      },
      {
        id: "drive",
        label: "试完车再看一遍",
        text: "冷车启动与热车后的现象分开填，路试记录写车速区间、路面和动作，不只写感觉不好。组件把空白栏和前后不同的记录排到末页，方便向卖方或修车师继续询问。奈德附言说，价格便宜可以接受小毛病，先知道自己带回去的究竟是什么，比现场逞懂更划算。",
      },
    ],
    requirements: ["chip-reader-writer"],
    ability:
      "在实际读写器上展示固定旧车验看流程，对照收录车型参数，整理使用者亲自输入的标识、读数和试车观察，列出缺项及差异；不远程扫描车辆、不核发产权证明，也不把未测部件判定为完好。",
    related: ["badlands"],
  },
  {
    slug: "route-packing-book",
    price: 25,
    rarity: "common",
    title: "明早出车的装箱单",
    kind: "diary",
    from: "荒原车队炊事员艾露／公开旅途札记",
    purpose: "data",
    summary: "从一次普通短途补给出车写起，整理饮水、工具、装卸顺序和随车饭。",
    parts: [
      {
        id: "packing",
        label: "先装不急着拿的",
        text: "重箱靠低处固定，下一站就卸的别压最里面。饮水按人和预计路程单独点数，再留一份延误余量；给水桶贴当天日期，喝用和清洗用分开。常用工具、急需药品和纸面联络表放能拿到的地方。艾露把咖啡从杂货栏划出来，说司机总会单独问第三遍。",
      },
      {
        id: "breakfast",
        label: "出发前那一顿",
        text: "五点半煎的饼到七点会软，所以夹馅少放汁，酱装小罐。昨晚新来的人问是不是每次出车都有仪式，艾露说没有，只是得确认没人空着肚子替大家搬货。装箱单背面有一道铅笔横线，跨过它的名字表示人已经吃过，可以去把最后几条绑带收紧。",
      },
    ],
    related: ["badlands"],
  },
  {
    slug: "pantry-scale-assist",
    price: 100,
    rarity: "uncommon",
    title: "一锅几人份·配餐换算组件",
    kind: "data",
    from: "黄碗与车队炊事员合编",
    purpose: "function",
    summary: "按实际人数、锅具容量和库存输入换算固定食谱，生成可人工复核的备料单。",
    parts: [
      {
        id: "portions",
        label: "人数不是唯一的格子",
        text: "先填吃饭人数，再选本次是否还有别的菜；原料按自己实际称出的库存输入。组件把收录食谱换成需要的份量，并显示用了哪条原始比例。水量受锅具容量限制，盐和辣椒先列基础量与后加量。每种替代材料都有独立条目，库存里只有面粉时不会凭空写出面饼。",
      },
      {
        id: "prep",
        label: "备料单上的最后一栏",
        text: "示例把八人豆锅换成十二人，发现现有锅装不下，便列为两锅各六人；清单随即把先洗切、先浸泡和临出锅再放的东西分开。最后一栏留给做饭的人写临时决定。编者保留了一条手写备注：今天来的三个搬运工刚下工，主食再多留些，别让计算器替你决定别人饿不饿。",
      },
    ],
    requirements: ["chip-reader-writer"],
    ability:
      "借助实际读写器，依据使用者输入的人数、库存重量和锅具容量，换算内置固定食谱并列出分锅备料单及计算依据；不扫描食物、不推断个人过敏或健康状况，不提供食材，也不代替称量和烹饪。",
    related: ["kabuki-market", "badlands", "coyote-cojo"],
  },
];

export const expandedChipContents: shardsRules.ChipContent[] = chipSeeds.map((seed) =>
  shardsRules.ChipContentSchema.parse({ ...seed, id: `chip-${seed.slug}` }),
);

export const expandedChipItems: inventoryRules.ItemDef[] = inventoryRules.ItemCatalogSchema.parse(
  chipSeeds.map((seed) => ({
    id: `shard-${seed.slug}`,
    name: `${seed.purpose === "function" ? "功能" : seed.purpose === "media" ? "媒体" : "资料"}芯片·${seed.title}`,
    kind: "misc",
    price: seed.price,
    rarity: seed.rarity,
    chipContentId: `chip-${seed.slug}`,
  })),
);
