import {
  type Acquaintance,
  type Board,
  BoardSchema,
  CharacterCardSchema,
  cyberwareRules,
  type RelationKind,
  START_CYBERWARE_RARITIES,
  type StartCyberware,
} from "@cp/core";
import { cyberware } from "./cyberware";
import { boardModules } from "./modules";
import { npcs } from "./npcs";

const library = (id: string) => {
  const found = boardModules.find((m) => m.id === id);
  if (!found) throw new Error(`模块库里没有 ${id}`);
  return found;
};

const chrome = (id: string, armSide?: cyberwareRules.ArmSide): StartCyberware => {
  const def = cyberware.find((c) => c.id === id);
  if (!def) throw new Error(`义体表里没有 ${id}`);
  if (def.iconic || !START_CYBERWARE_RARITIES.has(def.rarity)) {
    throw new Error(`开局预设义体不能使用 ${id}`);
  }
  const group = cyberwareRules.cyberwareExclusiveGroup(def);
  const category = cyberwareRules.cyberwareCategoryOf(def);
  return {
    id: def.id,
    name: def.name,
    humanityCost: def.humanityCost,
    slot: def.slot,
    rarity: def.rarity,
    category,
    ...(def.ability ? { ability: def.ability } : {}),
    ...(def.armor ? { armor: true } : {}),
    ...(def.accelerator ? { accelerator: true } : {}),
    ...(def.deckProfile ? { deckProfile: def.deckProfile } : {}),
    ...(group ? { exclusiveGroup: group } : {}),
    ...(armSide && group === "armMount" ? { armSide } : {}),
  };
};

const contact = (id: string, relation: RelationKind, note: string): Acquaintance => {
  const found = npcs.find((n) => n.id === id);
  if (!found) throw new Error(`人物表里没有 ${id}`);
  return { id: found.id, name: found.name, relation, note };
};

/** 1. 洛·门多萨「扳手」：沃森街头改装技师（经典初代示例角色全面适配新版架构） */
const loBoard: Board = BoardSchema.parse({
  origin: library("street-kid"),
  tarot: "magician",
  pasts: [
    {
      id: "custom-lo-garage",
      slot: "past",
      label: "改装车行学徒",
      tags: ["车", "技术"],
      ability:
        "在沃森区的地下改装车行摸爬滚打数年：精通引擎爆改、底盘调校与线路隐藏，熟络夜之城的车贩子与地下收赃渠道",
      hook: "车行老板曾协助帮派伪造车架号与武器挂载，那批黑账本上留有你的电子签名",
      people: [
        { name: "老韩", role: "带你入行的车行老油条，虽教了你一身手艺，但也拿你当过替罪羊" },
      ],
      custom: true,
    },
    library("past-border-run"),
  ],
  skills: [library("chrome-junkie"), library("mechanic"), library("lockpick"), library("driving")],
  flaws: [
    {
      id: "custom-lo-debt",
      slot: "flaw",
      label: "漩涡帮高利贷",
      tags: ["债务", "帮派"],
      ability: "欠下漩涡帮高利贷三千欧元，日计滞纳金正在疯狂跳动",
      hook: "清算死线迫在眉睫，还不上钱，漩涡帮的改装狂人就会拆下你的器官抵账",
      people: [{ name: "铁钳", role: "全脸改装红色义眼的漩涡帮头目，借钱给你的冷血债主" }],
      custom: true,
    },
  ],
  cyberware: [
    chrome("tech-utility-arm", "left"),
    chrome("ballistic-coprocessor"),
    chrome("tool-hand-fingers"),
    chrome("chemo-olfactory-filter"),
    chrome("subdermal-armor"),
    chrome("fortified-ankles"),
  ],
  kit: {
    cashTier: "standard",
    weapons: ["pipe-wrench"],
    vehicle: "thorton-galena",
  },
  acquaintances: [
    contact("viktor", "youOwe", "早年拆车伤到肌腱，老维没收全款帮接上了手部神经"),
    contact("claire", "friend", "常在阿罗约车库互相借焊枪、倒腾引擎备件与旧轮胎"),
    {
      id: "board-custom-lo-garage-1",
      name: "老韩",
      relation: "grudge",
      note: "拿你的电子签名顶了帮派黑账，把脏锅全扣在你头上",
    },
    {
      id: "board-custom-lo-debt-1",
      name: "铁钳",
      relation: "grudge",
      note: "漩涡帮高利贷债主，三千欧死线逼近，催收随时上门",
    },
  ],
  startLocation: "megabuilding-h10",
});

/** 2. 沈清漪「白鸦」：前公司反情报外勤（潜行读心与商务博弈流） */
const qingyiBoard: Board = BoardSchema.parse({
  origin: library("origin-corpo-counterintel"),
  tarot: "highpriestess",
  pasts: [library("past-corp-purge"), library("past-fixer-courier")],
  skills: [
    library("ice-veins"),
    library("micro-expression"),
    library("stealth"),
    library("corpo-negotiation"),
  ],
  flaws: [library("silenced-witness"), library("insomnia-static")],
  cyberware: [
    chrome("kiroshi-mk2"),
    chrome("visual-cortex-support"),
    chrome("audio-suite"),
    chrome("chroma-iris-overlay"),
    chrome("jaw-stash-implant"),
    chrome("synaptic-accelerator"),
    chrome("optical-camo"),
    chrome("hidden-personal-link"),
    chrome("lynx-paws"),
  ],
  kit: {
    cashTier: "stash",
    weapons: ["kenshin"],
    vehicle: "villefort-cortes",
  },
  acquaintances: [
    contact("meredith", "nod", "昔日在企业外勤线上交过手，彼此摸清底细但尚未翻脸"),
    contact("wakako", "youOwe", "清洗夜逃出公司广场时，借她的暗线洗掉一层身份记录"),
    contact("dino", "owesYou", "替他压下过一桩差点牵连市中心酒吧的企业审计风波"),
  ],
  startLocation: "corpo-plaza",
});

/** 3. 林零「断线客」：叛逃企业网行者（黑墙边缘纯粹潜网黑客流） */
const linlingBoard: Board = BoardSchema.parse({
  origin: library("origin-arasaka-netrunner"),
  tarot: "moon",
  pasts: [library("past-blackwall-burn"), library("past-lab-whistleblower")],
  skills: [
    library("eidetic-memory"),
    library("quickhacking"),
    library("drone-turret-hijack"),
    library("disguise-infiltration"),
  ],
  flaws: [library("corpo-blacklist"), library("memory-gaps")],
  cyberware: [
    chrome("arasaka-deck"),
    chrome("zetatech-net-optics"),
    chrome("ex-disk"),
    chrome("self-ice"),
    chrome("audio-suite"),
    chrome("thermo-comfort-weave"),
    chrome("hidden-personal-link"),
    chrome("monowire", "both"),
  ],
  kit: {
    cashTier: "standard",
    weapons: ["shingen"],
    vehicle: null,
  },
  acquaintances: [
    contact("nix", "friend", "暗网节点上结识的同行，常私下交换旧时代残片与冰墙情报"),
    contact("judy", "owesYou", "帮她清洗过几段暗藏企业追踪标的脏超梦底层协议"),
    contact("bryce-mosley", "grudge", "在太平洲外网嗅探时差点被他顺着跳板反锁真身位置"),
  ],
  startLocation: "kabuki-market",
});

/** 4. 阿列克谢·科瓦尔「铁砧」：公司战争退伍兵（恶土斯安威斯坦外骨骼重装独狼） */
const alexeiBoard: Board = BoardSchema.parse({
  origin: library("origin-war-vet"),
  tarot: "strength",
  pasts: [library("past-convoy-guard"), library("past-maxtac-brush")],
  skills: [
    library("pain-editor-nerve"),
    library("marksman"),
    library("brawling"),
    library("intimidation"),
  ],
  flaws: [library("old-wound"), library("no-one-left-behind")],
  cyberware: [
    chrome("zetatech-sandevistan"),
    chrome("gorilla-arms", "both"),
    chrome("titanium-bones"),
    chrome("linear-frame-sigma"),
    chrome("auto-suppressant-injector"),
    chrome("neural-sync-bridge"),
    chrome("chemo-olfactory-filter"),
    chrome("blood-pump"),
  ],
  kit: {
    cashTier: "standard",
    weapons: ["tactician", "overture"],
    vehicle: "thorton-mackinaw",
  },
  acquaintances: [
    contact("mitch", "friend", "统一战争装甲部队的老同袍，如今仍在恶土营地互相照应"),
    contact("panam", "owesYou", "去年在恶土公路帮她硬扛过一次乱刀会摩托车的交叉伏击"),
    contact("wilson", "nod", "同为战争退伍兵，去店里补弹药校枪机时总能聊上几句"),
  ],
  startLocation: "badlands",
});

/** 5. 卡门·德尔加多「赤蝶」：来生自由佣兵（高速螳螂刀与武士刀突袭流） */
const carmenBoard: Board = BoardSchema.parse({
  origin: library("origin-merc-survivor"),
  tarot: "sun",
  pasts: [library("past-heist-fallout"), library("past-street-racer")],
  skills: [
    library("bloodlust-rush"),
    library("danger-sense"),
    library("blades"),
    library("parkour-freerunning"),
  ],
  flaws: [library("enemy")],
  cyberware: [
    chrome("kiroshi-stalker"),
    chrome("kerenzikov"),
    chrome("mantis-blades", "both"),
    chrome("reinforced-tendons"),
    chrome("lynx-paws"),
    chrome("light-tattoo-circuit"),
    chrome("endorphin-micro-pump"),
    chrome("adrenaline-booster"),
  ],
  kit: {
    cashTier: "standard",
    weapons: ["katana", "liberty"],
    vehicle: "yaiba-kusanagi",
  },
  acquaintances: [
    contact("jackie", "friend", "海伍德混出来的老哥们，约好早晚在来生喝上彼此冠名酒"),
    contact("rogue", "nod", "替来生干过两单硬活，刚在她那儿挂上可靠独狼的名号"),
    contact("padre", "youOwe", "早年劫案失手折在海伍德，神父出面压住了瓦伦蒂诺追兵"),
  ],
  startLocation: "afterlife",
});

/** 6. 周明远「听风」：歌舞伎超梦调谐师（感官取证、智能武器与街头交涉流） */
const mingyuanBoard: Board = BoardSchema.parse({
  origin: library("origin-bd-editor"),
  tarot: "wheeloffortune",
  pasts: [library("past-watson-lockdown-trader"), library("past-scav-escape")],
  skills: [
    library("silver-tongue"),
    library("forensic-tracking"),
    library("streetwise"),
    library("first-aid"),
  ],
  flaws: [library("turf-ban")],
  cyberware: [
    chrome("kiroshi-oracle"),
    chrome("braindance-recorder"),
    chrome("visual-cortex-support"),
    chrome("audio-suite"),
    chrome("tactile-nerve-amp"),
    chrome("synth-pheromone-glands"),
    chrome("biomonitor"),
    chrome("smart-link"),
  ],
  kit: {
    cashTier: "standard",
    weapons: ["yukimura"],
    vehicle: "makigai-maimai",
  },
  acquaintances: [
    contact("judy", "friend", "丽姿地下室的超梦技术同好，常互借剪辑固件与音轨滤镜"),
    contact("regina", "owesYou", "替她从一盘黑超梦原片里扒出过清道夫据点的定位音轨"),
    contact("maiko", "ex", "在云顶外包项目里有过一段并不体面的纠葛，如今彼此提防"),
  ],
  startLocation: "lizzies-bar",
});

/** 官方预设角色模板：覆盖四大生态、不同命牌、义体流派与生活/感官改造，可直接开档或另存微调 */
export const sampleCharacters = CharacterCardSchema.array().parse([
  {
    name: "洛·门多萨",
    alias: "扳手",
    pronoun: "他",
    origin: "街头小子",
    look: "二十出头，身形精瘦挺拔、肩背紧实，留着利落的贴皮黑色平头。肤色偏深带拉丁裔轮廓，眉骨微凸、眼神警觉，双瞳装有基础岐路司光学义眼，暗光下偶有极淡的淡蓝反光。左前臂换装了一支耐造的二手技师工程义臂，右臂保留原生血肉，手背与指节留有多处焊枪烫伤和扳手崩裂的旧疤，颈侧可见两处磨损略显发灰的标准个人链路插口。",
    past: "在沃森区斑驳破败的筒子楼里挣扎长大，母亲死于帮派争夺地盘的流弹火并。十五岁起跟着地下车行老板老韩学修车、跑隔离墙暗货路线，却被老韩拿电子签名顶了帮派黑账。为替家里还急债又背上漩涡帮头目铁钳的三千欧高利贷，眼看清算死线逼近，只能靠手艺和那辆自己拼出来的加利纳在夜之城杀出一条活路。",
    personality:
      "沉默寡言，恩怨分明，对任何帮派势力抱有本能的戒备；习惯用嘴硬掩饰内心的波澜，唯独见不得街头恶徒对弱者和孩子肆意践踏。",
    voice:
      "语速偏快且短促，说话带着沃森汽修工特有的脏字与黑话，紧张时会下意识揉搓后颈；从不轻易说谢谢，但欠下的人情必定会拿命去还。",
    skills:
      "精通内燃机爆改、底盘调校与机械抢修，一眼能听出二手义体伺服异响；熟练绕过民用电子门禁与老旧监控，窄巷与荒野暗线飙车驾轻就熟。不走高阶网骇路数，只装了基础实战辅助义体，讲究用巧劲和地形周旋。",
    board: loBoard,
  },
  {
    name: "沈清漪",
    alias: "白鸦",
    pronoun: "她",
    origin: "公司反情报外勤",
    look: "二十七八岁，身姿修长挺直、步态轻缓近乎无声。冷白肤色配利落齐耳黑直短发，一侧发梢略掩颧骨；眉眼细长沉静，眸色偏深，义眼瞳环极细几乎难以肉眼察觉。下颌线条清瘦锋利，耳后至颈侧埋有近乎隐形的银灰色高频加密接口，小臂皮肤在强光下隐约可见光学迷彩的微细六边形贴合纹路。",
    past: "曾供职于跨国巨企反情报外勤部门，专责处理内部泄密、暗线信使交接与高管丑闻收尾。一场高层派系清洗骤然降临，她借着提前留下的离岸备付金与冈田和歌子的暗线洗去一层身份痕，在灭口小队合围前脱身。如今虽手握旧雇主不愿见光的底牌，却也在耳鸣与封口令的阴影下步步为营。",
    personality:
      "冷静克制、算无遗策，把情绪锁在极厚的防爆门后；从不轻信口头承诺，只看筹码与利害边界，却在暗处守着一条不滥杀局外人的底线。",
    voice:
      "吐字清晰平稳、语速从容，带着公司法务与外勤特有的礼貌疏离感；越是动了杀意或谈到死穴，声线反而越轻越淡，习惯用反问逼出对方破绽。",
    skills:
      "精于无声潜入、光学迷彩脱身与近距离精准消音点杀，擅长从微表情与措辞漏洞中拆穿谎言，精通企业合约条款与多方博弈；不擅长正面重火力对轰或硬扛围攻，习惯在开枪前就先把退路算尽。",
    board: qingyiBoard,
  },
  {
    name: "林零",
    alias: "断线客",
    pronoun: "TA",
    origin: "叛逃企业网行者",
    look: "二十岁出头，身形清瘦偏单薄、气质中性难辨性别。肤色苍白缺乏日晒，眼下挂着常年深潜留下的淡青倦影，灰黑色不对称碎发微遮左眉，浅灰义眼在检索数据时瞳孔边缘会浮起细密微光。后颈脊柱至肩胛嵌有一整排外露散热片与深潜插槽，双腕内侧留有单分子线收束口的暗银色微缝。",
    past: "原本是荒坂深层子网协议测试组的定向培养网行者，在一次逼近黑墙边缘的违规深潜实验里侥幸保住神智，却也因此失去数月记忆片段。察觉实验室打算销毁所有经手人后，TA 顺手拷走一截加密协议碎片逃入歌舞伎暗巷，自此挂上企业联合黑名单，靠给地下圈子洗协议与拆安防维生。",
    personality:
      "疏离敏感、好奇心压过恐惧，习惯把整座夜之城看成一张布满漏洞的实时拓扑图；对权威与监控有近乎本能的厌恶，极少敞开心扉，却愿意替真正懂行的人守秘密。",
    voice:
      "语调偏平、句式简练，偶尔夹杂潜网协议术语与冷幽默；思考时会下意识轻敲指节，被人强行打断思路时语气会瞬间变得锋利刻薄。",
    skills:
      "深谙企业级冰墙架构与快速破解，搭载荒坂接入仓、外接盘、自我 ICE 与隐蔽备用链路，可远程接管监控、无人机与自动炮塔；近身以单分子线和伪装潜入周旋。因黑墙烧灼留下神经隐痛与记忆断层，忌讳长时间肉搏与硬吃神经反冲。",
    board: linlingBoard,
  },
  {
    name: "阿列克谢·科瓦尔",
    alias: "铁砧",
    pronoun: "他",
    origin: "公司战争退伍兵",
    look: "三十五岁上下，体格魁梧厚实、肩宽臂长，站姿稳如铁桩。古铜色粗糙皮肤饱经恶土风沙侵蚀，灰褐短寸鬓角夹着几缕早生白发，短茬胡须修得随意；左眉骨至颧骨斜划一道陈年弹片旧疤，深灰瞳孔沉静少波澜。双臂已换装粗犷哑光黑大猩猩手臂，指关节镀铬磨损斑驳，后背脊柱外沿可见斯安威斯坦散热脊骨的金属接缝。",
    past: "经历过统一战争与企业代理冲突的焦土战壕，退伍后拒绝再替公司卖命，跟着老战友米契在恶土跑过几年武装车队押运。亲眼见过暴恐机动队空降清场的惨烈现场，也因此格外敬畏分寸与退路。如今开着一辆老麦基诺皮卡游走在城郊与夜之城边缘，只接明码标价、不背刺队友的硬活。",
    personality:
      "厚重少言、硬骨头，认死理也认交情；在火线上绝不丢下同伴，哪怕明知会多挨两枪，但对背信弃义的雇主和欺软怕硬的帮派毫不留情。",
    voice:
      "嗓音低沉沙哑，说话慢条斯理却自带压迫感，习惯用简短的战术口令式表达交代重点；喝上两口烈酒后才会松弛下来，偶尔冒出几句带着苦涩味的老兵冷笑话。",
    skills:
      "精通步枪、霰弹枪、大口径左轮与近身肉搏，凭着多年战壕磨出的铁骨与定力驾驭泽塔斯安威斯坦、大猩猩手臂、钛金骨骼与军用外骨骼承重架，正面破门压制与野外车队护卫极其老练。不懂网络破解，也不屑玩弯弯绕绕的办公室政治。",
    board: alexeiBoard,
  },
  {
    name: "卡门·德尔加多",
    alias: "赤蝶",
    pronoun: "她",
    origin: "来生自由佣兵",
    look: "二十四五岁，身材矫健紧绷、腰腿爆发力十足，动作干脆带着猎手般的轻盈感。小麦色健康肤色，黑发挑染暗红扎成高束马尾，额角剃出凌厉侧纹；深邃五官带拉丁裔神采，琥珀色义眼笑时锋利张扬。锁骨下纹着振翅火焰纹样，双前臂沿尺骨可见螳螂刀藏锋的细密暗红金属接缝，小腿外侧嵌有强化肌腱微调锁扣。",
    past: "在海伍德的霓虹与摩托轰鸣声里长大，跑过圣多明戈午夜非法飙车联赛，也曾因一单中途失控的企业押运劫案险些丢命，幸得神父出面才保住一条退路。那之后她干脆把筹码全押进来生酒吧——既然夜之城注定烧光所有人，不如骑着草薙摩托、亮着刀锋干一票让整座城市记住名字的大事。",
    personality:
      "张扬炽热、爱恨分明，越是绝境越能笑出声；把自由和名声看得比存款重，对看顺眼的朋友极讲义气，但绝不容许任何人替自己做决定。",
    voice:
      "语速明快、带点海伍德街头的挑衅与笑意，偶尔夹杂一两句西班牙语俚语；动手前喜欢干脆利落地放狠话，真到了生死一瞬反而收起玩笑、字字冷硬。",
    skills:
      "擅长武士刀与螳螂刀高速贴身斩杀，借助克伦齐科夫、强化肌腱与肾上腺素增强件在掩体与高楼间高速切入，对杀机有近乎野兽般的直觉；不喜冗长蹲守或对着终端逐行破译，偏爱抢占先手一波定胜负。",
    board: carmenBoard,
  },
  {
    name: "周明远",
    alias: "听风",
    pronoun: "他",
    origin: "超梦调谐师",
    look: "二十八岁左右，中等偏瘦身材、肩线微松，天生带着一副人畜无害的温和书卷气。东亚轮廓清俊，略微凌乱的黑发向后拢起几缕散落眉侧，常带几分漫不经心的浅笑，细看时深褐义眼却极专注地逐帧扫量细节。太阳穴两侧贴合着银灰色超梦神经调谐贴片接口，右手掌心嵌有清晰的智能武器感应纹路，左肩胛留着从清道夫手术台逃生时划开的狭长淡疤。",
    past: "原本在歌舞伎区替小作坊剪辑商业超梦，沃森封锁期里靠倒腾稀缺药剂、通行门路与地下片源攒下第一笔家底。两年前险些被买家出卖送进清道夫拆件窝点，拼着一口气反杀逃生后彻底摸清了夜之城的底色——也因坏过本地帮派一笔脏生意而被挂上地盘禁足令，如今常驻丽姿酒吧周边靠情报、超梦录制与人脉周旋求生。",
    personality:
      "圆滑通透、嘴甜心细，习惯把锋芒藏在笑脸与客套背后；不爱硬碰硬，总想先谈成买卖或找出隐藏第三条路，但真被逼到墙角时下手同样绝不手软。",
    voice:
      "声线温和带点慵懒市井味，极会顺着对方的话头递台阶、套近乎；分析现场线索或剪辑波形时会突然切换成冷静精确的技术口吻，三言两语点出违和之处。",
    skills:
      "精通超梦感官剪辑、现场痕迹勘查与黑市情报打听，体内植入超梦录制器便于第一视角取证，关键时刻还能靠战术急救稳住伤员，配合手部智能连接与幸村手枪补足自保火力；正面肉搏与重型武器非其所长。",
    board: mingyuanBoard,
  },
]);
