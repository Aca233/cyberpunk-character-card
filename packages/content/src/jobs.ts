import { falloutRules, jobsRules, type Twist } from "@cp/core";

/** 转折和两难素材：叙事模型挂委托或推剧情时取用，不强制套用 */
export const twists: readonly Twist[] = [
  {
    id: "target-already-dead",
    kind: "twist",
    text: "目标已经死了：有人抢先下手，或者目标自己伪造了死亡；到现场只找到尸体、替身或者一场布置好的戏，委托人未必知情。",
  },
  {
    id: "client-is-bait",
    kind: "twist",
    text: "委托人是诱饵：真正的雇主想借这单把角色引到某个地方、拖住某件事，或者让角色替人背锅。",
  },
  {
    id: "cargo-is-alive",
    kind: "twist",
    text: "货是活的：要运的“货”其实是一个人——偷渡客、逃出来的实验体、被绑的孩子——会说话，也会求你。",
  },
  {
    id: "innocent-witness",
    kind: "dilemma",
    text: "无辜的目击者：动手时撞见一个和这事无关的人（清洁工、孩子、路过的情侣）；放走会留下线索，灭口要赔人性。",
  },
  {
    id: "double-offer",
    kind: "dilemma",
    text: "两头出价：干到一半，目标或对手开出更高的价钱让角色反水；收了得罪中间人，不收就多一个敌人。",
  },
  // 以下 20 条本作改编：街头委托常见的变故，自拟
  {
    id: "leak",
    kind: "twist",
    text: "消息走漏：现场早有人等着——中间人那边有人嘴不严，或者委托人同时找了两拨人，先到的不是你。",
  },
  {
    id: "rival-crew",
    kind: "twist",
    text: "同行撞车：另一伙佣兵接了同一单，或者接了反过来的那单，在现场碰上；抢、合作还是先撤。",
  },
  {
    id: "target-is-known",
    kind: "twist",
    text: "目标是熟人：要对付的人是角色认识的人，或者和身边的人有关系；名字直到见面才对上。",
  },
  {
    id: "corp-behind",
    kind: "twist",
    text: "背后是公司：一单看着是街头恩怨的活，背后站着一家公司；做完就上了某个档案。",
  },
  {
    id: "cargo-is-hot",
    kind: "twist",
    text: "货烫手：要拿或要送的东西被公司或帮派满城找，带着追踪器，谁拿着谁就是靶子。",
  },
  {
    id: "client-dies",
    kind: "twist",
    text: "委托人中途死了：干到一半雇主被人做掉；钱找谁要、活还干不干、杀雇主的人是不是也在找你。",
  },
  {
    id: "wrong-address",
    kind: "twist",
    text: "地方不对：情报给错了楼层、错了人，或者目标昨晚就搬了，到场一头撞进不相干的麻烦里。",
  },
  {
    id: "recorded",
    kind: "twist",
    text: "被录下来了：现场有人在录超梦，或者目标装着记录义体；角色做的每件事都可能变成别人手里的录像。",
  },
  {
    id: "ncpd-sting",
    kind: "twist",
    text: "警方钓鱼：这单是 NCPD 或网络监察设的套，现场有便衣；收手还来得及，硬干就是自投罗网。",
  },
  {
    id: "target-slipping",
    kind: "twist",
    text: "目标快失控了：要找的人义体装得太多，正滑向赛博精神病，逼急了会当场发作。",
  },
  {
    id: "pay-or-save",
    kind: "dilemma",
    text: "撤离窗口：货车就要开走，身边的人却受伤走不了；追货可能耽误救治，留下救人可能丢单，先把时间和危险说清楚，也允许玩家另找办法。",
  },
  {
    id: "child-in-house",
    kind: "dilemma",
    text: "屋里有家人：目标的家人没有离开现场；照原计划动手会把无关的人卷进去，等他们走或换个地方动手又可能错过机会。",
  },
  {
    id: "spare-the-guard",
    kind: "dilemma",
    text: "求饶的守卫：守卫放下枪求你放过他，说家里还有人等；他知道出口和报警点，如何安置他会影响撤离，放走不等于一定遭到背叛。",
  },
  {
    id: "frame-someone",
    kind: "dilemma",
    text: "让人背锅：雇主临时要求把现场布置成另一个人干的，那人只是碍着雇主的路；拒绝可能拿不到尾款，照办会给无辜的人招来追杀。",
  },
  {
    id: "partner-cut",
    kind: "dilemma",
    text: "临时加价：合作的外援发现风险比约定的大，要求加钱才肯继续；谈条件、另找人或自己顶上都要付出代价，已经确认的小队分成不能被悄悄改掉。",
  },
  {
    id: "evidence-found",
    kind: "dilemma",
    text: "撞见不该看的东西：翻到一份实验记录、一张名单或者一本行贿账；拿走能卖钱、能当筹码，也可能招来灭口，留下就得装作没看见。拍一份藏起来、转给记者或中间人也行，各有风险，事先讲明谁会找上门。",
  },
  {
    id: "old-debt",
    kind: "twist",
    text: "旧账找上门：现场有人认出角色，跟角色有过节（被坑过的同行、挨过打的帮派小弟、被出卖的线人），想趁这单把账算清；可以当场了结、谈条件或者先避开，但他不会就此罢休。",
  },
  {
    id: "gang-cut",
    kind: "dilemma",
    text: "地头抽成：这单落在帮派地盘上，地头的人要分一份；不给就来搅局、给目标报信，给了委托人那边拿到的就少。也可以找中间人说情、拿别的东西抵，或者赶在他们反应过来前干完走人。",
  },
  {
    id: "lie-to-client",
    kind: "dilemma",
    text: "瞒不瞒委托人：查到的真相会让委托人拒付尾款，或者让他做出更糟的事（报复无辜的人、灭口知情人）；照实说、瞒下来、只说一半都行，但说出口的话以后会被对上。",
  },
  {
    id: "humane-cost",
    kind: "dilemma",
    text: "手段与底线：有人提出下毒、拿家人要挟或利用信任等办法，是否可行、谁会反对、会伤害谁都取决于已有事实。玩家可以拒绝、寻找其他办法或放弃；替代路线不预设必须更难，关系变化取决于当事人知道了什么。",
  },
];

/** 后果素材按影响程度组织；发生与否取决于世界因果，不按星级发放损伤或关系扣分。 */
export const consequences = falloutRules.ConsequenceTableSchema.parse([
  {
    risk: 1,
    label: "吃点小亏",
    examples: [
      "擦伤",
      "赔掉一两百欧元，或者丢一件普通的东西",
      "路人记住了你的脸",
      "目睹失约的人变得不信任，是否原谅取决于理由与后续行动",
      "多绕一段路，耽误一两个小时",
    ],
  },
  {
    risk: 2,
    label: "伤筋动骨",
    examples: [
      "重伤以下的伤",
      "丢几百到一千欧元，或者报酬被扣一两成",
      "公开动了手，警方热度上来",
      "相关的人因亲历损失而疏远、追问或要求补偿",
      "货物因碰撞或保存不当受损；期限变化须由有权决定的人说明理由",
    ],
  },
  {
    risk: 3,
    label: "代价明显",
    examples: [
      "重伤",
      "被缴械，或者丢一件罕见装备",
      "对方发现了具体漏洞并作出防备，原来的办法可能因此失效",
      "中间人因已知的违约失去信任，雇主根据收到的证据起疑",
      "受影响的人在得到线索后开始追查；限期要求须有提出者与具体原因",
    ],
  },
  {
    risk: 4,
    label: "元气大伤",
    examples: [
      "已确认的致命危险实际命中且保护不足时，可能造成致命伤",
      "身上的欧元和背包被搜走一部分",
      "一个帮派或公司记下了你的名字",
      "目标被转移、雇主撤单或合作破裂，使委托无法继续；约定期限不能无故改变",
      "身边的人受伤、被抓",
    ],
  },
  {
    risk: 5,
    label: "改变人生",
    examples: [
      "濒死，或者被抓走变成一条剧情线",
      "被悬赏、被追杀",
      "失去一个重要的人",
      "义体在被俘或手术中被拆除，功能丧失；心理反应按本人经历与处境发展",
    ],
  },
]);

/** 8 类委托的模板：分段结构、潜入和对峙放在哪、典型败局、适合的转折；叙事模型取素材，不强制套用 */
export const jobTemplates = jobsRules.JobTemplateCatalogSchema.parse([
  {
    kind: "escort",
    moments: "1–2 次：路上被截（伏击或追车），到地方前的最后一道坎",
    stealth: "换路线、换车、让被护送的人乔装，能躲掉一次截击",
    standoff: "截车的人常常先喊话要人，可以谈价或吓退",
    defeat: "被护送的人被抢走或受重伤，雇主翻脸",
    twists: ["client-is-bait", "cargo-is-alive", "leak", "rival-crew", "client-dies", "gang-cut"],
  },
  {
    kind: "assassinate",
    moments: "1 次解决目标，或 2 次：近身动手、脱身",
    stealth: "踩点、混进去、等目标落单；警戒到搜索档之前动手最干净",
    standoff: "保镖或目标本人可能先开口求饶、开价或拿人质要挟",
    defeat: "目标逃走，知道是谁要他死，从此多一个宿敌",
    twists: [
      "target-already-dead",
      "double-offer",
      "innocent-witness",
      "target-is-known",
      "child-in-house",
      "humane-cost",
    ],
  },
  {
    kind: "abduct",
    moments: "2 次：拿到人、带着人跑；带着人时撤退更难",
    stealth: "潜进去找到人是主体，被带的人可能拖慢、出声或不配合",
    standoff: "看守拿人质要挟、或者被救的人不肯走时",
    defeat: "人没带出来，或者带出来的是错的人、已经受了重伤",
    twists: [
      "cargo-is-alive",
      "client-is-bait",
      "innocent-witness",
      "wrong-address",
      "target-is-known",
      "spare-the-guard",
    ],
  },
  {
    kind: "steal",
    moments: "最好一次也不打；被发现时 1–2 次：抢出来、逃出去",
    stealth: "主体是潜入：踩点、骇摄像头、弄到门禁卡；警戒度决定这单干不干净",
    standoff: "撞见守卫或同行时，可以对峙、谈条件、分赃",
    defeat: "东西没拿到，或者拿到了但被拍到，热度上来",
    twists: [
      "client-is-bait",
      "double-offer",
      "cargo-is-hot",
      "recorded",
      "evidence-found",
      "rival-crew",
      "partner-cut",
    ],
  },
  {
    kind: "sabotage",
    moments: "0–1 次：装好东西以后脱身；被发现时守卫和增援堵出口",
    stealth: "摸到设备旁边是关键；骇入能远程完成一部分",
    standoff: "工人或保安撞见时，可以吓走、收买或劝离",
    defeat: "破坏没成，或者成了但伤到无辜，人性和热度都要付",
    twists: [
      "innocent-witness",
      "client-is-bait",
      "corp-behind",
      "spare-the-guard",
      "frame-someone",
      "ncpd-sting",
    ],
  },
  {
    kind: "investigate",
    moments: "通常不打；查到真相时有人来灭口，1 次",
    stealth: "翻档案、跟踪、潜进办公室；超梦调查能还原现场",
    standoff: "盘问知情人时常常变成对峙，说中诉求对方才开口",
    defeat: "线索断了、知情人被灭口，或者调查把自己暴露了",
    twists: [
      "target-already-dead",
      "client-is-bait",
      "evidence-found",
      "lie-to-client",
      "corp-behind",
      "target-slipping",
    ],
  },
  {
    kind: "negotiate",
    moments: "本来不打；谈崩才开打，通常 1 次",
    stealth: "事先查清对方底牌、带上筹码，比现场掷骰管用",
    standoff: "主体就是对峙：说中诉求、亮出筹码、镇定门槛达标都能谈下来",
    defeat: "谈崩，双方都记仇；或者谈下来的条件把雇主卖了",
    twists: [
      "double-offer",
      "client-is-bait",
      "old-debt",
      "gang-cut",
      "lie-to-client",
      "partner-cut",
    ],
  },
  {
    kind: "deliver",
    moments: "1–2 次：路上被劫、交货时被黑吃黑",
    stealth: "绕开检查站、换车、走恶土小路，能躲掉一次截击",
    standoff: "交货现场常常变成对峙：对方压价、扣货或者想不付钱",
    defeat: "货丢了或被调包，要赔货主",
    twists: [
      "cargo-is-alive",
      "double-offer",
      "cargo-is-hot",
      "ncpd-sting",
      "pay-or-save",
      "old-debt",
    ],
  },
]);

// 模板里引用的转折要在素材表里
for (const t of jobTemplates) {
  for (const id of t.twists) {
    if (!twists.some((x) => x.id === id))
      throw new Error(`委托模板 ${t.kind} 引用了不存在的转折 ${id}`);
  }
}
