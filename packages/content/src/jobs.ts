import { falloutRules, jobsRules, type Twist } from "@cp/core";

/** 转折和两难素材：主持人挂委托或推剧情时取用，不强制套用 */
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
];

/** 后果参考表：按委托星级给分量和例子，帮主持人保持分量和多样性，不随机强制 */
export const consequences = falloutRules.ConsequenceTableSchema.parse([
  {
    risk: 1,
    label: "吃点小亏",
    examples: [
      "擦伤",
      "赔掉一两百欧元，或者丢一件普通的东西",
      "路人记住了你的脸",
      "小角色好感 −2 到 −3",
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
      "相关的人好感 −3 到 −5",
      "期限提前半天，或者货受了损",
    ],
  },
  {
    risk: 3,
    label: "代价明显",
    examples: [
      "重伤",
      "被缴械，或者丢一件罕见装备",
      "对方有了防备，后面同样的办法难度值 +2",
      "中间人信任度下降、雇主起疑",
      "冒出一个盯上你的人，加一个期限",
    ],
  },
  {
    risk: 4,
    label: "元气大伤",
    examples: [
      "致命伤（检定事先说明了才会有）",
      "身上的欧元和背包被搜走一部分",
      "一个帮派或公司记下了你的名字",
      "委托黄掉，或者期限大幅提前",
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
      "义体被拆走，人性重挫",
    ],
  },
]);

/** 8 类委托的模板：交锋结构、潜入和对峙放在哪、典型败局、适合的转折；主持人取素材，不强制套用 */
export const jobTemplates = jobsRules.JobTemplateCatalogSchema.parse([
  {
    kind: "escort",
    moments: "1–2 次：路上被截（伏击或追车），到地方前的最后一道坎",
    stealth: "换路线、换车、让被护送的人乔装，能躲掉一次截击",
    standoff: "截车的人常常先喊话要人，可以谈价或吓退",
    defeat: "被护送的人被抢走或受重伤，雇主翻脸",
    twists: ["client-is-bait", "cargo-is-alive"],
  },
  {
    kind: "assassinate",
    moments: "1 次解决目标，或 2 次：近身动手、脱身",
    stealth: "踩点、混进去、等目标落单；警戒到搜索档之前动手最干净",
    standoff: "保镖或目标本人可能先开口求饶、开价或拿人质要挟",
    defeat: "目标逃走，知道是谁要他死，从此多一个宿敌",
    twists: ["target-already-dead", "double-offer", "innocent-witness"],
  },
  {
    kind: "abduct",
    moments: "2 次：拿到人、带着人跑；带着人时撤退更难",
    stealth: "潜进去找到人是主体，被带的人可能拖慢、出声或不配合",
    standoff: "看守拿人质要挟、或者被救的人不肯走时",
    defeat: "人没带出来，或者带出来的是错的人、已经受了重伤",
    twists: ["cargo-is-alive", "client-is-bait", "innocent-witness"],
  },
  {
    kind: "steal",
    moments: "最好一次也不打；被发现时 1–2 次：抢出来、逃出去",
    stealth: "主体是潜入：踩点、骇摄像头、弄到门禁卡；警戒度决定这单干不干净",
    standoff: "撞见守卫或同行时，可以对峙、谈条件、分赃",
    defeat: "东西没拿到，或者拿到了但被拍到，热度上来",
    twists: ["client-is-bait", "double-offer"],
  },
  {
    kind: "sabotage",
    moments: "0–1 次：装好东西以后脱身；被发现时守卫和增援堵出口",
    stealth: "摸到设备旁边是关键；骇入能远程完成一部分",
    standoff: "工人或保安撞见时，可以吓走、收买或劝离",
    defeat: "破坏没成，或者成了但伤到无辜，人性和热度都要付",
    twists: ["innocent-witness", "client-is-bait"],
  },
  {
    kind: "investigate",
    moments: "通常不打；查到真相时有人来灭口，1 次",
    stealth: "翻档案、跟踪、潜进办公室；超梦调查能还原现场",
    standoff: "盘问知情人时常常变成对峙，说中诉求对方才开口",
    defeat: "线索断了、知情人被灭口，或者调查把自己暴露了",
    twists: ["target-already-dead", "client-is-bait"],
  },
  {
    kind: "negotiate",
    moments: "本来不打；谈崩才开打，通常 1 次",
    stealth: "事先查清对方底牌、带上筹码，比现场掷骰管用",
    standoff: "主体就是对峙：说中诉求、亮出筹码、镇定门槛达标都能谈下来",
    defeat: "谈崩，双方都记仇；或者谈下来的条件把雇主卖了",
    twists: ["double-offer", "client-is-bait"],
  },
  {
    kind: "deliver",
    moments: "1–2 次：路上被劫、交货时被黑吃黑",
    stealth: "绕开检查站、换车、走恶土小路，能躲掉一次截击",
    standoff: "交货现场常常变成对峙：对方压价、扣货或者想不付钱",
    defeat: "货丢了或被调包，要赔货主",
    twists: ["cargo-is-alive", "double-offer"],
  },
]);

// 模板里引用的转折要在素材表里
for (const t of jobTemplates) {
  for (const id of t.twists) {
    if (!twists.some((x) => x.id === id))
      throw new Error(`委托模板 ${t.kind} 引用了不存在的转折 ${id}`);
  }
}
