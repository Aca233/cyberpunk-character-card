import type { RuleModule } from "../../kernel/system";
import { behaviorChipLines, cyberwareCatalog } from "../cyberware";
import { currentOutfit } from "./apply";
import { bodyLine, scanTacticalProfile, woundNote } from "./body";
import {
  KNOWN_SOURCE_LABELS,
  type LedgerKind,
  NO_FACTION,
  NO_FACTION_LABEL,
  NPC_CHROME_MAX,
  NPC_GEAR_MAX,
  NPC_UNDECIDED_PREFIX,
  type Npc,
  type NpcState,
} from "./schema";

/** 不在场的人最多列这么多个，最近出场的优先 */
export const OFFSTAGE_LISTED = 20;

/** 人物卡上人情和仇的写法；给模型看，所以写「玩家角色」，不写「你」 */
const LEDGER_CARD_LABELS: Readonly<Record<LedgerKind, string>> = {
  owesYou: "欠玩家角色人情",
  youOwe: "玩家角色欠的人情",
  grudge: "记玩家角色的仇",
};

export const npcRules: RuleModule<NpcState> = {
  id: "npcs",
  title: "人物",
  commands: [
    "npc",
    "npcUpdate",
    "meet",
    "memory",
    "npcDeath",
    "doing",
    "relation",
    "npcOutfit",
    "tie",
    "ledger",
    "ledgerSettle",
    "learn",
    "npcHurt",
    "npcHeal",
    "npcGear",
    "npcChrome",
    "npcHumanity",
    "npcScan",
    "npcCompanion",
  ],
  when: () => true,
  judge: `- 对话、说服、谈判、套话看对方当下处境、利益诉求、底线、人情债与实际筹码：触到底线或没有足以打动对方的条件就不会答应，不靠数值公式决定。
- 人物未卸防前藏着的核心秘密只有你知道，可用于判断对方会不会说漏嘴或顺水推舟，不直接写进玩家可见摘要。
- 有卡的人能做什么看卡上的体格、装备、义体与伤势：重伤或残缺做不了剧烈动作，没装接入仓的人破不了子网，倒下了什么也做不了。
- 标了「同行中」的人正跟玩家一起行动：其装备、义体、专长与伤势是现场真实的协同条件，玩家对其下达调度或分工按其实际能力、状态与立场裁决；关系紧张或拿对方当炮灰时对方会拒绝或翻脸。
- 死了的人不再出场。`,
  narrate: `- 每轮的【人物】里列着已有人物卡的人：在场的带完整的卡，不在场的只有一行。诉求、底线和秘密是幕后设定，玩家只能知道有实际来源或已揭露的内容。
- 演人物时照卡上的说话方式和样本写，口吻前后一致；样本只是参考，不照搬原句。对方对你冷热如何看卡上的态度、关系、人情与仇怨，能不能谈成看诉求和底线。
- 写人物的样子照卡上的「长相」和「现在穿」：长相不会变，穿着只在正文里真的换了衣服时才变，前后一致，不要每次见面换一身。
- 人物后面括号里的「势力」带着这个组织现在对玩家的态度：没打过交道的成员先按组织的态度对待玩家（敌对的提防、盘问、找茬，见面就打的直接动手，友好的给方便、递消息，自己人当兄弟）；打过交道的按两人过往交情，但仍会顾忌组织的立场，当着同伙的面更要表态。言谈和细节里自然带出自己是哪家的人：帮派的颜色和黑话、公司的工牌和腔调、警察的警徽。
- 要写新人物之前，先看【人物】里「这一带的老面孔」和不在场的人有没有合适的能用；同一个酒保、总被撞见的混混、上次放走的人可以反复出现，优先让他们重新出场，不要另起炉灶。
- 会再出现、或者推动剧情的配角（递货的、接头的、要玩家角色跟着走的、开口谈条件的），让他在正文里自报名字或外号，或者由旁人叫出来；擦肩而过的路人不用起名。
- 重要新人物或尚未定型的旧识首次正式出场时，身份、外貌、穿着、随身装备、义体与说话方式应互相一致；夜之城人物通常带有符合身份与财力的常见基础或专业义体（纯肉身属少数特例），按这个人的工作、财力和行事方式自然呈现，不套职业模板，不为介绍人物而额外安排动作或秘密揭露；后续沿用已经确立的事实。
- 【帮派与公司据点的常态电子战编组】：虎爪帮、漩涡帮、巫毒帮、幽冥犬与所有公司安保/高危委托据点绝不是全员裸奔的纯枪手靶子——设计据点守卫、交火小队或幕后看场时，应自然包含本地子网防火墙、配「自我 ICE」或接地/防火镀层的头目与重装打手，以及至少 1 名坐镇监控室/暗处或随队联线的敌方网络黑客（配接入仓），让黑客玩法真正遇到破冰、反追踪与黑客对垒。
- 承诺、人情、冲突这类以后会被提起的事，让人物记着、以后提起。死了的人不再出场，也不会发消息。
- 人物有自己的日子，不是为玩家角色存在的：见面时先带着他自己的事来（刚碰上的麻烦、心情、手上正忙的活），会主动提起「最近」和「这段时间的经历」里的事，会提起「共同记忆」里的旧事、翻旧账、兑现或追问承诺；有自己的事要忙时会拒绝、改约、让玩家等，不随叫随到。交情与信任要看得出变化：熟了说话更随便、开玩笑、说点心里话，生分了客气、冷淡、话少。
- 标了「同行中」的人正跟玩家角色一起行动（搭档干活、护送、同行转场）：照其性格、装备与伤势自然参与掩护、配合、吐槽或分工；失手吃亏或受伤算在对方自己身上，不替玩家做决定；若谈崩、有急事或分道扬镳则分开各自行动。
- 人物之间也认识：卡上的「认识的人」只说明关系，不是共享消息的网络。熟人出事后，先看他是否亲历、接到通信或听见传闻，以及消息何时能到；没有来源就仍不知道，可以主动打听。收到的说法可能滞后或有误，不自动等于幕后真相；标了「暗地里」的关系不当着外人提。
- 卡上的「最近」是这个人在屏幕外的近况，后续行动须接续已有进展。时间大段跳过时，有前因的离屏事件可以继续发展；只有新闻、传闻、通信或本人告知确实到达时，才进入玩家的知情范围，不替玩家做事。
- 卡上的「玩家角色知道」是玩家角色已经知道的这个人的事；角色只按这些和亲眼看到的说话行事，没打听过的身份、来历、秘密不能写成角色知道。
- 卡上的「身体状态」写着这个人的伤势、装备、义体与人性状态：照着真实装备和伤势写他的本事与极限。人性状态只有你知道，不直接报术语；开始下滑时只从言行里透出征兆（手抖、说话变冷、嗑药、对义体着魔），严重时甚至失控。`,
  text: `- 每轮的【人物】里列着已有人物卡的人：在场的带完整的卡，诉求、底线和秘密只有你知道，不能直接说给玩家，只能从言行里透出来；不在场的只有一行。
- 演人物时照卡上的说话方式和样本写，口吻前后一致；样本只是参考，不照搬原句。态度冷热看两人交情和人情仇怨，能不能答应看诉求和底线。
- 要写新人物之前，先看【人物】里「这一带的老面孔」和不在场的人有没有合适的能用；同一个酒保、总被撞见的混混、上次放走的人可以反复出现，让他们出场写 meet，不要另建一张差不多的卡。
- 人物出场、或者第一次见面，写一条 meet（附带当前地点 id）；和玩家角色有了实质互动、或者推动了剧情（递货、接头、对暗号、要玩家角色跟着走、开口谈条件）的新人物，当场用 npc 建卡，id 用小写拼音或英文；正文没给名字时 name 用正文里的称呼（例如「兜帽男」「灰夹克」），不要因为没名字就不建。只是擦肩而过、端盘子、待在背景里的是路人，不建卡。人物在正文里离开当前现场去往别处时，用 doing 更新其动向与新 location。
- 用 npc 建卡时务必把人物立丰满，不要建空壳「普通人」：
  - faction：属于哪个势力就写【当前状态】势力列表里的 id（漩涡帮写 maelstrom、虎爪帮写 tyger-claws、荒坂写 arasaka），无势力写 none。
  - look 与 outfit：look 只写不会变的长相（体格骨架、年龄感、发型、疤痕纹身、外露义体、小习惯动作，至少 2–3 个具体记忆点）；outfit 务必顺手写清现在穿什么（外套裤鞋、徽章链饰、明面带的枪或工具包）。正文里有卡的人换了穿着（换上潜水服、穿正装赴宴、衣服被打烂换了一件），才写一条 npcOutfit，一句话替换「现在穿」；没换就不写。
  - voice 与 samples：voice 写清语速、音色、黑话/口癖、态度反差；samples 写 1–3 句口吻鲜活的示范台词（优先取正文里他刚说过的原话，不足就照性格补一两句）。
  - want、limit 与 secret：want 写明当下真正图谋的人/钱/权/脱身，limit 写明绝不能踩的逆鳞，别用「赚钱」「活下去」敷衍；只要不是一次过场的工具人，尽量补一条暗中的 secret（真实来历、私下买卖、把柄或软肋），只写进卡里供幕后演戏，**不要同时写进 learn** 提前剧透给玩家（除非正文当场戳破或本人自曝）。若有固定据点/店面且在地点表里，顺手填 home。
  - body：先认正文已明确的型号、衣着、随身物件与无植入事实，再结合【新人物装备选型参考】按这个人的工作、财力、装备来源和行动方式选型。gear 从【物品表】选实际穿着的衣物（外套、内搭、裤鞋、头面饰件）、武器与药剂/工具/日常随身物品 id，最多 ${NPC_GEAR_MAX} 件；普通人也应有合身衣着与随身小物，能空手的普通人不硬塞枪，持枪者按隐蔽携带、近战突入、远距压制等真实用途选枪，不默认统一手枪。
  - cyberware 从【义体表】选 0–${NPC_CHROME_MAX} 件：按夜之城常态，大多数人物（包括市民、商贩、雇员、中间人、帮派成员与佣兵）通常常配 1–3 件贴合身份、生计与财力的基础或常见义体；只有正文明确无植入、信仰排斥义体或极端拮据者才留空。普通人可按日常与生计搭配基础岐路司义眼、生物监测、合成肺叶、持握衬垫、通用义肢、防火/接地镀层等；**帮派头目、精锐打手、公司特勤、中间人与重装义体人（尤其虎爪帮、漩涡帮、巫毒帮、幽冥犬、荒坂、军用科技、康陶）应常态配置 self-ice（自我 ICE）以及贴合防线的 grounding-plating（接地镀层）/ fireproof-coating（防火涂层），帮派/公司据点里的敌方网络黑客务必实配对应档次的接入仓（如 biotech-sigma、fuyutsuki-deck、militech-paraline、arasaka-deck 等）与 self-ice**，不要把据点敌人全建成无冰白板。明确无植入或配置已定时照事实保留。仅受物理互斥约束（主接入仓与脊柱加速/狂暴可双装，重型双臂武装限 2 件，感官/时尚/亲密/暗格/工具类义体可自由叠加），智能自导须有真实联锁。只用表内 id，不写属性点或档位；候选不限制完整目录，也不证明店里有货。
- 如果【人物】里非原作人物标着「档案未定型」或「长相」/「说话」还标着「还没定」（主板/自定义旧识首次真切出场），发一条 npcUpdate 把缺失字段和初始资料一次定型；已定型人物的装备与义体只能用 npcGear / npcChrome 按真实变化增减，不用 npcUpdate 整栏覆盖。原作人物（canon）核心卡面固定，不发 npcUpdate。
- 玩家角色对有势力的人做的事大到组织会知道（杀了、救了、当众羞辱、替他办成大事），除了人物态度变化外，同时写一条 faction 改这个势力的态度；私下的小恩小怨只改个人态度。
- 人物对玩家没有好感度数字，完全按真实发生过的事与彼此知情边界决定冷热：承诺、帮过的忙、冲突、背叛这类以后会被提起的事写一条 memory；欠下或结下人情与仇怨写 ledger；双方关系出现实质性变化才写 relation 更新关系定性。memory、learn、doing、relation、ledger 等指令的 id 必须填【人物】中该目标人物卡本身的 id（如 royce、yoko-tsuru、ozob），不要给单条记忆或情报另起事件 slug；不同人物的 memory/learn 拆成独立事件组，互不连累。
- 正文透出某个有卡的人最近在做什么（本人说起、新闻、传闻、消息），写一条 doing，会替换旧的；正文没写到的不记。
- 关系真的变了（一起扛过事、说过真心话、生死与共，或者背叛、被拆穿大谎、伤了对方在乎的人）才写一条 relation，一句话写现在的关系，会替换旧的；关系热络只说明对方愿意见你，不等于交情深。
- 人物之间的关系不意味着消息自动互通。记录他已经得知的事时保留目击、通信或传闻来源及时间；不能仅因熟人出事就写成他已经知情。正文里透出两个有卡的人之间的关系（搭档、亲人、旧情、上下家、结仇），或者关系变了，写一条 tie，aToB、bToA 各从一边的角度写一句，会替换两人之间旧的那条；见不得光的关系 open 写 false。
- 欠下或结下以后会被讨回来的人情和仇，写一条 ledger（owesYou 对方欠玩家角色、youOwe 玩家角色欠对方、grudge 对方记玩家角色的仇）；还了、报了、放下了，写 ledgerSettle，entry 填卡上「人情和仇」那一条的编号。
- 死了的人不再出场，也不会发消息。
- 卡上的「玩家角色知道」是玩家角色已经知道的这个人的事；角色只按这些和亲眼看到的说话行事，没打听过的身份、来历、秘密不能写成角色知道。正文里角色得知了有卡的人的一件事（本人说起、别人提到、传闻新闻、扫描），写一条 learn，照角色以为的写，骗人的话照骗的写；卡上已经有的不再写。
- 有卡的人实际受了伤写 npcHurt（part 填受伤部位 head / face / chest / belly / left-arm / right-arm / left-leg / right-leg 之一，tier 写 graze / heavy / lethal，reason 写明怎么伤的），得到治疗写 npcHeal；重伤需实际医疗稳定并等待恢复，不因切场自动痊愈，死了另写 npcDeath。已登记在当前交战中的敌人倒下、死亡或逃走时，另写 combat foe，state 分别为 down、dead、fled；仅受伤但仍站着不写 foe。玩家角色实际扫描了有卡的人写 npcScan，不写 combat scan。
- 有卡的人拿到或丢了武器、换穿或脱下衣服、收下或递出药剂工具等随身物品写 npcGear，装上或拆掉义体写 npcChrome；玩家角色出钱给同行者买装备、装义体，或现场约好分账/付酬劳，同时写 money 扣钱。商店买卖（含卖给枪店/摊主）由 trade 自动入店库存，不给店主另发 npcGear。
- 只有在剧情里明确结伴同行（同车转场、护送、一起去下一个地点）时才写 npcCompanion（following:true）；仅在同一个任务现场碰面、交谈、交易或并肩打一仗但之后各走各路的人，绝对不要写 following:true。已经标了「同行中」的人，只要正文里已经分开、告别、留守、交接完毕或玩家独自前往别处，必须写 npcCompanion（following:false）解除同行。同行者只有在场面真正陷入必死绝境（lethal）且确实避无可避时才会死，平时受创写 npcHurt。
- 有卡的人实际出现神经症状时写 npcHumanity affect（symptomId、symptom、stage、reason），真实缓解写 recover 引用 symptomId；经历和义体本身不自动扣分。玩家只知道已经观察到的表现。`,
};

export const adultServicesRules: RuleModule<NpcState> = {
  id: "adult-services",
  title: "夜之城色情生态与行为芯片",
  commands: ["npcBehavior"],
  when: (state, input) =>
    /性偶|玩偶|云顶|丽姿|莫克斯|扭扭街|成人|性工作|行为芯片|安全词|芯片接管|亲密|预约|\bR18\b/i.test(
      input.text,
    ) ||
    Object.values(state.npcs).some(
      (person) =>
        person.met &&
        (/性偶|性工作|玩偶|成人服务|超梦/.test(person.role) || person.behaviorChips !== undefined),
    ),
  judge: `- 成人服务只发生在已明确成年的参与者之间；夜之城分三层生态：扭扭街（清醒肉身性偶，无行为芯片，靠本人真实反应与口头谈价）、丽姿酒吧（莫克斯帮护持的感官超梦夜店，主打定制超梦与地下室调校，不搞强制玩偶托管）、云顶（H8 虎爪帮控制的玩偶屋，前台扫神经网络匹配，包厢内靠行为芯片托管且受虎爪帮保安与黑客控制）。
- 行为芯片（doll-behavior-chip）统一四态（off 清醒 / doll 玩偶托管 / protocol 改装协议 / glitch 故障被骇）：没有装芯片的人不会被接管；玩偶托管只利用前台/现场实际取得的数据，不读心；安全词可随时打断托管退回 off。
- 付款、芯片托管反应与本人清醒意愿彼此独立；本人拒绝、改约或中止须按实际发生处理。改装协议（如武术、礼仪、伪装等）在激活时提供真实动作/表现条件，高强度或长时间运行可能引发自我抽离类神经症状，且容易遭敌方黑客远程干扰。`,
  narrate: `- 区分三层场所气质与本人清醒度：扭扭街直白烟火气、丽姿霓虹迷幻且有人情护短、云顶精致梦幻却带着商业监控与记忆断层的凉意。普通聊天、消费、熟客来往与私人亲密都可平静收场，不强塞任务、危机或好感奖励。
- 明确区分清醒本人（off）与玩偶托管（doll）：托管切回 off 时若芯片无事后回忆，本人对托管期间的对话与细节断片；本人查过设备日志只知道日志文字，不等于恢复亲历感受。`,
  text: `- 店内服务消费直接走 trade（service:adult-service 或 bd-session），需要跟踪正在进行的体验时用 commerce.service（start/pause/resume/finish/exit）。询价不扣款，付款不自动切换芯片模式。
- 真实芯片操作写 npcBehavior（NPC）或 cyberware.behavior（玩家）：mode 填 off / doll / protocol（须写 protocol 协议名）/ glitch。安全词或中途打断托管切回 off；托管中设备确实留下摘要才 log，清醒后本人实际查阅才 review。
- 处于 doll 断片态时，禁止把托管过程记入本人 memory；恢复清醒后只有通过 source:"told" 或已查阅的 source:"log" 才进入本人所知。`,
};

export interface Stage {
  /** 玩家角色所在的地点 id */
  readonly location: string | null;
  /** 当前场景开始的游戏时间；这一场里出过场的人算在场 */
  readonly sceneStartedAt: number;
  /** 地点 id 所在的城区；查不到是 undefined。不传就不分「这一带的老面孔」 */
  readonly districtOf?: ((location: string) => string | undefined) | undefined;
  /** 内容数据（物品表、义体表）和此刻的游戏时间；都传了才写「身体」和伤势 */
  readonly data?: Readonly<Record<string, unknown>> | undefined;
  readonly now?: number | undefined;
  readonly input?: string | undefined;
  /** 当前提示词阶段；非 extract 时不输出指令名 */
  readonly stage?: "judge" | "narrate" | "extract" | undefined;
  /**
   * 势力 id 换成「名字，对玩家什么态度」：
   * 由组合层按势力表和势力态度给，人物系统不引势力系统；不传只写 id
   */
  readonly factionOf?: ((faction: string, npcId?: string) => string | undefined) | undefined;
}

/** 「这一带的老面孔」最多列这么多个，见过的、最近出场的优先 */
export const LOCALS_LISTED = 8;

export function onStage(npc: Npc, stage: Stage): boolean {
  if (!npc.alive) return false;
  if (npc.following) return true;
  if (stage.location !== null && npc.location !== null && npc.location !== stage.location) {
    return false;
  }
  if (stage.location !== null && npc.location === stage.location) return true;
  // 只有玩家或人物地点未知时，才按本场最近一次见面时间回退判断
  if (stage.location !== null && npc.location === null) return false;
  return npc.lastSeenAt !== null && npc.lastSeenAt >= stage.sceneStartedAt;
}

/** 所属势力（用户 2026-10-31："npc加个所属势力 没有就填无"）：写势力 id，模型写 faction 指令时对得上 */
function factionNote(npc: Npc, stage: Stage): string {
  const detail = stage.factionOf?.(npc.faction, npc.id);
  if (npc.faction === NO_FACTION) {
    return detail ? `势力${NO_FACTION_LABEL}（${detail}）` : `势力${NO_FACTION_LABEL}`;
  }
  return detail ? `势力 ${npc.faction}（${detail}）` : `势力 ${npc.faction}`;
}

function label(npc: Npc, stage: Stage): string {
  return `${npc.name}${npc.alias ? `（外号${npc.alias}）` : ""}［${npc.id}，${npc.pronoun}，${factionNote(npc, stage)}］`;
}

/**
 * 卡上的「认识的人」（用户 2026-10-31："npc也有自己的生活，也有认识的npc"）：名字、id、一句关系，
 * 关系不是获知渠道；死亡是幕后世界事实，不能自动算作这个 NPC 或玩家已知。
 */
function tiesNote(npc: Npc, npcs: NpcState["npcs"]): string | undefined {
  if (npc.ties.length === 0) return undefined;
  return npc.ties
    .map((t) => {
      const other = npcs[t.id];
      const name = other?.name ?? t.id;
      const marks = [
        ...(other && !other.alive ? ["幕后事实：已死；此人是否获知须看已有目击或消息来源"] : []),
        ...(t.open ? [] : ["暗地里"]),
      ];
      return `${name}［${t.id}］：${t.text}${marks.length > 0 ? `（${marks.join("，")}）` : ""}`;
    })
    .join("；");
}

/** 卡上的长相和现在穿的；没有穿着（旧卡衣着还写在 look 里）时照旧写一行「外貌」 */
function appearanceLines(npc: Npc): string[] {
  const wearing = currentOutfit(npc);
  return wearing === undefined
    ? [`  外貌：${npc.look}`]
    : [`  长相：${npc.look}`, `  现在穿：${wearing}`];
}

/** 用纯事实概括不在场人物与玩家的当前关系，不依赖任何好感数字 */
export function relationBrief(npc: Pick<Npc, "relation" | "ledger" | "memories">): string {
  const parts: string[] = [];
  if (npc.relation?.text) parts.push(npc.relation.text);
  const open = npc.ledger.filter((e) => e.settledAt === null);
  const owesYou = open.filter((e) => e.kind === "owesYou").length;
  const youOwe = open.filter((e) => e.kind === "youOwe").length;
  const grudges = open.filter((e) => e.kind === "grudge").length;
  if (grudges > 0) parts.push(`记仇 ${grudges} 笔`);
  if (owesYou > 0) parts.push(`欠玩家人情 ${owesYou} 笔`);
  if (youOwe > 0) parts.push(`玩家欠他人情 ${youOwe} 笔`);
  if (parts.length === 0 && npc.memories.length > 0) {
    parts.push(`共同经历 ${npc.memories.length} 件`);
  }
  return parts.length > 0 ? parts.join("，") : "交情尚浅";
}

function fullCard(npc: Npc, stage: Stage, npcs: NpcState["npcs"] = {}): string {
  const isExtract = stage.stage === "extract";
  const isJudge = stage.stage === "judge";
  const isNarrate = !isExtract && !isJudge;
  const unfinalized =
    !npc.canon &&
    (npc.look.startsWith(NPC_UNDECIDED_PREFIX) || npc.voice.startsWith(NPC_UNDECIDED_PREFIX));
  const unfinalizedHeader =
    isExtract && unfinalized ? "；【档案未定型：需 npcUpdate 补全外貌、代词、口吻与 body】" : "";

  const lines = [
    `- ${label(npc, stage)} ${npc.role}${npc.following ? "；【同行中】" : ""}${npc.met ? "" : "；还没见过玩家角色"}${unfinalizedHeader}`,
  ];

  // 正文阶段给完整演出卡（长相、说话、台词样本、生平底色）；判断与抽取只保留当前穿着供裁决与换装核对
  if (isNarrate) {
    // 长相和穿着分两行（用户定的，2026-11-02："长相 + 当前穿着"）；旧卡没拆时只有一行外貌
    lines.push(...appearanceLines(npc), `  说话：${npc.voice}`);
    if (npc.samples.length > 0) {
      lines.push(`  样本：${npc.samples.map((s) => `「${s}」`).join(" ")}`);
    }
    if (npc.bio) {
      lines.push(`  生平与底色（幕后人物资料，不等于玩家已知）：${npc.bio}`);
    }
  } else {
    const wearing = currentOutfit(npc);
    if (wearing !== undefined) lines.push(`  现在穿：${wearing}`);
  }

  // 诉求、底线、中间人做派供正文演戏与判断裁决/潜台词便笺使用；抽取只记已发生事实，不需要幕后动机
  if (!isExtract) {
    lines.push(`  诉求：${npc.want}`, `  底线：${npc.limit}`);
    if (Array.isArray(stage.data?.fixerTemperaments)) {
      const alias = npc.id === "mr-hands" ? "hands" : npc.id;
      const temp = (
        stage.data.fixerTemperaments as readonly {
          readonly id: string;
          readonly preferredStyle: string;
          readonly taboo: string;
        }[]
      ).find((t) => t.id === npc.id || t.id === alias);
      if (temp) {
        lines.push(`  中间人做派：偏好「${temp.preferredStyle}」；忌讳「${temp.taboo}」`);
      }
    }
  }

  if (npc.age !== undefined || npc.adult !== undefined || npc.entity !== undefined) {
    lines.push(
      `  已定身份事实：${npc.age !== undefined ? `${npc.age} 岁；` : ""}${npc.adult === true ? "已确认成年；" : npc.adult === false ? "未成年；" : ""}${npc.entity === "human" ? "真人" : npc.entity === "synthetic" ? "合成人" : npc.entity === "robot" ? "机器人" : "实体身份未补定"}。这些事实不代表玩家已全部获知。`,
    );
  }

  // 幕后秘密仅提供给判断（潜台词/泄密裁决）与正文（人物演出）；抽取阶段隐藏，彻底杜绝把未揭露秘密错记为玩家已知
  if (!isExtract && npc.secret) {
    lines.push(`  幕后秘密（不等于玩家或其他 NPC 已知）：${npc.secret}`);
    lines.push(
      "  揭露条件：按当前目的、利益与底线决定是否愿意说，或由具体目击、证据和通信揭露；熟悉、人情、仇怨或一次扫描都不自动公开秘密。玩家已经得知的部分仅以知识记录和已发生正文为准。",
    );
  }

  if (stage.data !== undefined && stage.now !== undefined) {
    lines.push(`  ${bodyLine(npc, stage.data, stage.now, stage.stage)}`);
    if (npc.vitals?.scannedAt !== undefined && npc.vitals.scannedAt !== null) {
      if (isExtract) {
        lines.push("  【玩家已用义眼扫描此人】");
      } else {
        const tactical = scanTacticalProfile(npc, stage.data, stage.now);
        lines.push(
          `  【玩家已用义眼扫描此人】玩家已掌握其植入体配置、威胁档次（${tactical.threatLabel}）与骇入条件（${tactical.netLabel}）${tactical.tips.length > 0 ? `；实战情报：${tactical.tips.join("；")}` : ""}。玩家针对这些已扫出的义体、护甲弱点、旧伤或无 ICE 缺口采取行动、骇入或交涉施压时，直接享有确切情报与先手优势。`,
        );
      }
    }
    lines.push(
      ...behaviorChipLines(
        npc.body?.cyberware ?? [],
        npc.behaviorChips,
        cyberwareCatalog(stage.data),
        stage.input,
      ).map((line) => `  ${line}`),
    );
  }
  if (npc.relation) lines.push(`  关系：${npc.relation.text}`);
  const ties = tiesNote(npc, npcs);
  if (ties) lines.push(`  认识的人：${ties}`);
  if (npc.known.length > 0) {
    lines.push(
      `  玩家角色知道：${npc.known.map((k) => `${k.text}（${KNOWN_SOURCE_LABELS[k.source]}）`).join("；")}`,
    );
  }
  const open = npc.ledger.map((e, i) => ({ e, n: i + 1 })).filter(({ e }) => e.settledAt === null);
  if (open.length > 0) {
    lines.push(
      `  人情和仇：${open.map(({ e, n }) => `${n}. ${LEDGER_CARD_LABELS[e.kind]}：${e.text}`).join("；")}`,
    );
  }
  if (npc.memories.length > 0) lines.push(`  共同记忆：${npc.memories.join("；")}`);
  if (npc.doing) lines.push(`  最近：${npc.doing.text}`);
  const earlier = npc.timeline.slice(0, -1).map((t) => t.text);
  if (npc.past || earlier.length > 0) {
    lines.push(
      `  这段时间的经历：${[...(npc.past ? [npc.past.text] : []), ...earlier].join("；")}`,
    );
  }
  return lines.join("\n");
}

function oneLine(npc: Npc, stage: Stage): string {
  if (!npc.alive) {
    const off = npc.offscreenDeath;
    if (off !== null && !npc.known.some((k) => k.at >= off.at)) {
      const tail =
        stage.stage === "extract"
          ? "正文里让玩家听说或撞见时写一条 learn"
          : "在玩家亲耳听说或亲眼撞见之前，不要写成玩家角色已知";
      return `- ${label(npc, stage)} ${npc.role}；在玩家没看着的地方死了（${off.cause}），玩家角色还不知道；${tail}`;
    }
    return `- ${label(npc, stage)} ${npc.role}；已死`;
  }
  const unfinalized =
    !npc.canon &&
    (npc.look.startsWith(NPC_UNDECIDED_PREFIX) || npc.voice.startsWith(NPC_UNDECIDED_PREFIX));
  const unfinalizedTag = !unfinalized
    ? ""
    : stage.stage === "extract"
      ? "；【档案未定型：正式出场时需 npcUpdate 补全外貌、代词、口吻与 body】"
      : "；【外貌与说话口吻尚未定型，首次照面时按身份与经历自然定下来】";
  if (!npc.met) {
    return `- ${label(npc, stage)} ${npc.role}；还没见过${npc.location ? `，常在 ${npc.location}` : ""}${unfinalizedTag}`;
  }
  const wound =
    stage.data !== undefined && stage.now !== undefined
      ? woundNote(npc, stage.data, stage.now)
      : undefined;
  const hurt = wound ? `；${wound}` : "";
  const doing = npc.doing ? `；最近：${npc.doing.text}` : "";
  return `- ${label(npc, stage)} ${npc.role}；关系：${relationBrief(npc)}${npc.location ? `，最后在 ${npc.location}` : ""}${hurt}${doing}${unfinalizedTag}`;
}

/** 玩家角色所在的城区；不在地点表里、或者没传 districtOf 时是 undefined */
function stageDistrict(stage: Stage): string | undefined {
  if (stage.location === null || !stage.districtOf) return undefined;
  return stage.districtOf(stage.location);
}

/** 不在场、活着、常在或最后出现在这个城区的人：写新人物前先看能不能用他们 */
export function localFaces(state: NpcState, stage: Stage): Npc[] {
  const district = stageDistrict(stage);
  if (district === undefined || !stage.districtOf) return [];
  const districtOf = stage.districtOf;
  return Object.values(state.npcs)
    .filter((n) => n.alive && !onStage(n, stage))
    .filter((n) => {
      const places = [n.location ?? n.home, ...(n.hangouts ?? [])];
      return places.some(
        (where) => where !== null && where !== undefined && districtOf(where) === district,
      );
    })
    .sort((a, b) => Number(b.met) - Number(a.met) || (b.lastSeenAt ?? -1) - (a.lastSeenAt ?? -1))
    .slice(0, LOCALS_LISTED);
}

/** 给模型看的【人物】：在场的人带完整的卡，这一带的老面孔和其余的人每人一行 */
export function castSection(state: NpcState, stage: Stage): string {
  const all = Object.values(state.npcs);
  if (all.length === 0) return "还没有人物卡。";
  const here = all.filter((n) => onStage(n, stage));
  const locals = localFaces(state, stage);
  const localIds = new Set(locals.map((n) => n.id));
  const away = all
    .filter((n) => !onStage(n, stage) && !localIds.has(n.id))
    .sort((a, b) => (b.lastSeenAt ?? -1) - (a.lastSeenAt ?? -1))
    .slice(0, OFFSTAGE_LISTED);
  const line = (n: Npc) => oneLine(n, stage);
  const parts: string[] = [];
  parts.push(
    here.length > 0
      ? `在场：\n${here.map((n) => fullCard(n, stage, state.npcs)).join("\n")}`
      : "在场：没有有卡的人。",
  );
  if (locals.length > 0) {
    parts.push(
      `这一带（${stageDistrict(stage)}）的老面孔，要写新人物前先看能不能让他们出场：\n${locals.map(line).join("\n")}`,
    );
  }
  if (away.length > 0) parts.push(`不在场：\n${away.map(line).join("\n")}`);
  return parts.join("\n");
}
