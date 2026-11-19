import type { RuleModule } from "../../kernel/system";
import { behaviorChipLines, cyberwareCatalog } from "../cyberware";
import { currentOutfit } from "./apply";
import { bodyLine, woundNote } from "./body";
import {
  KNOWN_SOURCE_LABELS,
  type LedgerKind,
  NO_FACTION,
  NO_FACTION_LABEL,
  NPC_CHROME_MAX,
  NPC_GEAR_MAX,
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
    "affinity",
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
  ],
  when: () => true,
  judge: `- 对话、说服、谈判、套话看对方当下处境、利益诉求、底线、人情债与实际筹码：触到底线或没有足以打动对方的条件就不会答应，不靠数值公式决定。
- 人物未卸防前藏着的核心秘密只有你知道，可用于判断对方会不会说漏嘴或顺水推舟，不直接写进玩家可见摘要。
- 有卡的人能做什么看卡上的体格、装备、义体与伤势：重伤或残缺做不了剧烈动作，没装接入仓的人破不了子网，倒下了什么也做不了。
- 死了的人不再出场。`,
  narrate: `- 每轮的【人物】里列着已有人物卡的人：在场的带完整的卡，不在场的只有一行。诉求、底线和秘密是幕后设定，玩家只能知道有实际来源或已揭露的内容。
- 演人物时照卡上的说话方式和样本写，口吻前后一致；样本只是参考，不照搬原句。对方对你冷热如何看卡上的态度、关系、人情与仇怨，能不能谈成看诉求和底线。
- 写人物的样子照卡上的「长相」和「现在穿」（用户定的，2026-11-02）：长相不会变，穿着只在正文里真的换了衣服时才变，前后一致，不要每次见面换一身。
- 人物后面括号里的「势力」带着这个组织现在对玩家的态度（用户 2026-10-31："势力还是感觉好没存在感"）：没打过交道的成员先按组织的态度对待玩家（敌对的提防、盘问、找茬，见面就打的直接动手，友好的给方便、递消息，自己人当兄弟）；打过交道的按两人过往交情，但仍会顾忌组织的立场，当着同伙的面更要表态。言谈里带出自己是哪家的人：帮派的颜色和黑话、公司的工牌和腔调、警察的警徽。
- 要写新人物之前，先看【人物】里「这一带的老面孔」和不在场的人有没有合适的能用；同一个酒保、总被撞见的混混、上次放走的人可以反复出现，让他们出场写 meet，不要另建一张差不多的卡。
- 会再出现、或者推动剧情的配角（递货的、接头的、要玩家角色跟着走的、开口谈条件的），让他在正文里自报名字或外号，或者由旁人叫出来；擦肩而过的路人不用起名。
- 重要新人物或尚未定型的旧识首次正式出场时，身份、外貌、穿着、实际装备和说话方式应互相一致；结合【新人物装备选型参考】按职业、财力、势力供应与战斗习惯决定真实武装和植入用途，不把每个人都写成同一把枪配基础义眼。后续沿用已经确立的事实；不为介绍人物而额外安排动作或秘密揭露。
- 承诺、人情、冲突这类以后会被提起的事，让人物记着、以后提起。死了的人不再出场，也不会发消息。
- 人物有自己的日子，不是为玩家角色存在的（用户 2026-10-31："感觉没有活人感""感觉是为了我才存在的"）：见面时先带着他自己的事来（刚碰上的麻烦、心情、手上正忙的活），会主动提起「最近」和「这段时间的经历」里的事，会提起「共同记忆」里的旧事、翻旧账、兑现或追问承诺；有自己的事要忙时会拒绝、改约、让玩家等，不随叫随到。交情与信任要看得出变化：熟了说话更随便、开玩笑、说点心里话，生分了客气、冷淡、话少。
- 人物之间也认识：卡上的「认识的人」只说明关系，不是共享消息的网络。熟人出事后，先看他是否亲历、接到通信或听见传闻，以及消息何时能到；没有来源就仍不知道，可以主动打听。收到的说法可能滞后或有误，不自动等于幕后真相；标了「暗地里」的关系不当着外人提。
- 卡上的「最近」是这个人在屏幕外的近况，后续行动须接续已有进展。时间大段跳过时，有前因的离屏事件可以继续发展；只有新闻、传闻、通信或本人告知确实到达时，才进入玩家的知情范围，不替玩家做事。
- 卡上的「玩家角色知道」是玩家角色已经知道的这个人的事；角色只按这些和亲眼看到的说话行事，没打听过的身份、来历、秘密不能写成角色知道。
- 卡上的「身体状态」写着这个人的伤势、装备、义体与人性状态：照着真实装备和伤势写他的本事与极限。人性状态只有你知道，不直接报术语；开始下滑时只从言行里透出征兆（手抖、说话变冷、嗑药、对义体着魔），严重时甚至失控。`,
  text: `- 每轮的【人物】里列着已有人物卡的人：在场的带完整的卡，诉求、底线和秘密只有你知道，不能直接说给玩家，只能从言行里透出来；不在场的只有一行。
- 演人物时照卡上的说话方式和样本写，口吻前后一致；样本只是参考，不照搬原句。态度冷热看两人交情和人情仇怨，能不能答应看诉求和底线。
- 要写新人物之前，先看【人物】里「这一带的老面孔」和不在场的人有没有合适的能用；同一个酒保、总被撞见的混混、上次放走的人可以反复出现，让他们出场写 meet，不要另建一张差不多的卡。
- 人物出场、或者第一次见面，写一条 meet；和玩家角色有了实质互动、或者推动了剧情（递货、接头、对暗号、要玩家角色跟着走、开口谈条件）的新人物，当场用 npc 建卡，id 用小写拼音或英文；正文没给名字时 name 用正文里的称呼（例如「兜帽男」「灰夹克」），不要因为没名字就不建。只是擦肩而过、端盘子、待在背景里的是路人，不建卡。
- 用 npc 建卡时务必把人物立丰满，不要建空壳「普通人」：
  - faction：属于哪个势力就写【当前状态】势力列表里的 id（漩涡帮写 maelstrom、虎爪帮写 tyger-claws、荒坂写 arasaka），无势力写 none。
  - look 与 outfit：look 只写不会变的长相（体格骨架、年龄感、发型、疤痕纹身、外露义体、小习惯动作，至少 2–3 个具体记忆点）；outfit 务必顺手写清现在穿什么（外套裤鞋、徽章链饰、明面带的枪或工具包）。正文里有卡的人换了穿着（换上潜水服、穿正装赴宴、衣服被打烂换了一件），才写一条 npcOutfit，一句话替换「现在穿」；没换就不写（用户定的，2026-11-02）。
  - voice 与 samples：voice 写清语速、音色、黑话/口癖、态度反差；samples 写 1–3 句口吻鲜活的示范台词（优先取正文里他刚说过的原话，不足就照性格补一两句）。
  - want、limit 与 secret：want 写明当下真正图谋的人/钱/权/脱身，limit 写明绝不能踩的逆鳞，别用「赚钱」「活下去」敷衍；只要不是一次过场的工具人，尽量补一条暗中的 secret（真实来历、私下买卖、把柄或软肋），只写进卡里供幕后演戏，**不要同时写进 learn** 提前剧透给玩家（除非正文当场戳破或本人自曝）。若有固定据点/店面且在地点表里，顺手填 home。
  - body：先认正文已明确的型号、能力与无植入事实，再结合【新人物装备选型参考】按这个人的工作、财力、装备来源和行动方式选型。gear 从【物品表】选实际随身的衣物与武器 id，最多 ${NPC_GEAR_MAX} 件；能空手的普通人不硬塞枪，持枪者按隐蔽携带、近战突入、远距压制等真实用途选枪，不默认统一手枪。
  - cyberware 从【义体表】选真正服务其工作与经历的 id，最多 ${NPC_CHROME_MAX} 件，按人物需要决定数量，不凑满、不默认只填基础义眼；专业人物有相应需要与来源时，应配实际用得到的神经、循环、皮肤、骨骼、手臂、腿部或黑客硬件，而不是只换义眼等级。留意部位上限，接入仓/斯安威斯坦/狂暴只能选一个操作系统，智能自导须有真实联锁。只用表内 id，不写属性点或档位；候选不限制完整目录，也不证明店里有货。
- 如果【人物】里非原作人物的「长相」或「说话」还标着「还没定」（主板/自定义旧识首次真切出场），或者先前建卡太简略的非原作人物在这一轮补出了穿着、口吻样本、诉求秘密或随身武装，发一条 npcUpdate 把缺失或「还没定」的字段一次补齐；保留已确立的装备，无义体也可以是明确设定，不能只因选型参考换了就补装。原作人物（canon）核心卡面固定，不发 npcUpdate。
- 玩家角色对有势力的人做的事大到组织会知道（杀了、救了、当众羞辱、替他办成大事），除了人物态度变化外，同时写一条 faction 改这个势力的态度（用户 2026-10-31："势力还是感觉好没存在感"）；私下的小恩小怨只改个人态度。
- 只在对方真的有理由对你改观或翻脸时才写 attitude/affinity 变动，一轮里同一个人最多一条；承诺、人情、冲突这类以后会被提起的事写一条 memory。
- 正文透出某个有卡的人最近在做什么（本人说起、新闻、传闻、消息），写一条 doing，会替换旧的；正文没写到的不记。
- 关系真的变了（一起扛过事、说过真心话、生死与共，或者背叛、被拆穿大谎、伤了对方在乎的人）才写一条 relation，一句话写现在的关系，会替换旧的；关系热络只说明对方愿意见你，不等于交情深。
- 人物之间的关系不意味着消息自动互通。记录他已经得知的事时保留目击、通信或传闻来源及时间；不能仅因熟人出事就写成他已经知情。正文里透出两个有卡的人之间的关系（搭档、亲人、旧情、上下家、结仇），或者关系变了，写一条 tie，aToB、bToA 各从一边的角度写一句，会替换两人之间旧的那条；见不得光的关系 open 写 false。
- 欠下或结下以后会被讨回来的人情和仇，写一条 ledger（owesYou 对方欠玩家角色、youOwe 玩家角色欠对方、grudge 对方记玩家角色的仇）；还了、报了、放下了，写 ledgerSettle，entry 填卡上「人情和仇」那一条的编号。
- 死了的人不再出场，也不会发消息。
- 卡上的「玩家角色知道」是玩家角色已经知道的这个人的事；角色只按这些和亲眼看到的说话行事，没打听过的身份、来历、秘密不能写成角色知道。正文里角色得知了有卡的人的一件事（本人说起、别人提到、传闻新闻、扫描），写一条 learn，照角色以为的写，骗人的话照骗的写；卡上已经有的不再写。
- 有卡的人实际受了伤写 npcHurt（part 填受伤部位 head / face / chest / belly / left-arm / right-arm / left-leg / right-leg 之一，tier 写 graze / heavy / lethal，reason 写明怎么伤的），得到治疗写 npcHeal；重伤需实际医疗稳定并等待恢复，不因切场自动痊愈，死了另写 npcDeath。已登记在当前交战中的敌人倒下、死亡或逃走时，另写 combat foe，state 分别为 down、dead、fled；仅受伤但仍站着不写 foe。玩家角色实际扫描了有卡的人写 npcScan，不写 combat scan。
- 有卡的人拿到或丢了武器、换了衣服写 npcGear，装上或拆掉义体写 npcChrome；玩家角色出钱给队员买装备、装义体，同时写 money 扣钱。
- 有卡的人实际出现神经症状时写 npcHumanity affect（symptomId、symptom、stage、reason），真实缓解写 recover 引用 symptomId；经历和义体本身不自动扣分。玩家只知道已经观察到的表现。`,
};

export const adultServicesRules: RuleModule<NpcState> = {
  id: "adult-services",
  title: "成人服务与行为芯片",
  commands: ["npcBehavior"],
  when: (state, input) =>
    /性偶|玩偶|成人|性工作|接客|芯片接管|亲密|约会|扭扭街|诺亚|预约|\bR18\b/i.test(input.text) ||
    Object.values(state.npcs).some(
      (person) =>
        person.met &&
        (/性工作|玩偶|成人服务/.test(person.role) || person.behaviorChips !== undefined),
    ),
  judge: `- 成人服务只发生在已明确成年的参与者之间，未知年龄或成年情况先确认，不由职业、外貌或付费推断。真人从业者、已装行为芯片的真人玩偶和明确设定的合成人/机器人按各自身份与能力处理。
- 先明确提供者、范围、时长、价格、记录许可和提前结束条件，双方实际接受才开始。付款、设备权限、工作中的配合、本人持续意愿、私人信任与感情彼此独立；本人拒绝或中止须按实际发生处理，不能凭付款或设备迎合推翻。
- 行为芯片只利用实际取得的客户资料与现场输入，不读取玩家心声；安装、启用、当时意识、事后亲历和查阅日志是不同事实。没有装设备的人不会因为职业而被接管。`,
  narrate: `- 相处沿正文和自由输入继续、暂停、略写或结束；普通聊天、购买、熟客来往和私人亲密都可平静收场，不强加危机、秘密、任务或好感奖励。
- 回访沿用同一人、工作地点与实际说过的小事。人物可以忙、休息、改约、拒绝，也有同事和普通生活。经营者只知道亲眼见过或实际收到的资料；本人断片期间的事不自动成为其回忆。
- 明确区分本人主导与芯片接管；依固定条件呈现当时意识和事后记忆。本人看过日志只知道日志写了什么，不等于恢复当时的感受。设备摘要不自动产生超梦、录音或分享许可。玩家自身设备不能替玩家决定感情、台词或行动意图。`,
  text: `- 收费服务沿 commerce.offer（kind:service、target:adult-service、session 约定完整）与引用报价的 trade 成交，不用 favor 或 money 绕开授权。询价不扣款，接受商业服务不自动开启芯片；进度沿 commerce.service 的累计实际分钟结算，略写正常完成仍经过剩余时长，中止按已经明确的条件，不另加一次 time。
- 真实芯片操作写 npcBehavior：mode 指定 personal/chip；进入 chip 必须在接管前引用本人同意范围的 consent 与实际启动 evidence。退出可由本人或真实中断触发，不把返回本人主导写成自动获知过程。不要因玩家出资替其他人安装、启动或编辑人格。
- 有记录能力且接管中真实留下摘要时才 log，使用稳定 log id 与固定 text；不把所有接待自动写成日志。本人恢复后实际查阅才 review。设备日志不是当事人的共同亲历，不自动送进记忆或共享给前台。
- 记本人真实知情时，memory 的 source 以 experienced（本人实际能保留的亲历）、told（后来实际被告知）、log（本人已 review，须 device/log）分别记录。断片后的本人不能复述没有获知的过程，尤其不能把芯片迎合、付款或日志摘要当作私人情感。前台、同行者与本人分别记录各自真正知情的内容。`,
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
  /**
   * 势力 id 换成「名字，对玩家什么态度」（用户 2026-10-31："势力还是感觉好没存在感"）：
   * 由组合层按势力表和势力态度给，人物系统不引势力系统；不传只写 id
   */
  readonly factionOf?: ((faction: string) => string | undefined) | undefined;
}

/** 「这一带的老面孔」最多列这么多个，见过的、最近出场的优先 */
export const LOCALS_LISTED = 8;

export function onStage(npc: Npc, stage: Stage): boolean {
  if (!npc.alive) return false;
  if (stage.location !== null && npc.location === stage.location) return true;
  return npc.lastSeenAt !== null && npc.lastSeenAt >= stage.sceneStartedAt;
}

/** 所属势力（用户 2026-10-31："npc加个所属势力 没有就填无"）：写势力 id，模型写 faction 指令时对得上 */
function factionNote(npc: Npc, stage: Stage): string {
  if (npc.faction === NO_FACTION) return `势力${NO_FACTION_LABEL}`;
  const detail = stage.factionOf?.(npc.faction);
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

/** 将内部关系积累转译为定性态度描述，不在提示词中暴露数字 */
export function attitudeLabel(npc: Pick<Npc, "affinity">): string {
  const a = npc.affinity;
  if (a <= -60) return "水火不容";
  if (a <= -25) return "敌视戒备";
  if (a < 0) return "冷淡提防";
  if (a < 20) return "疏离公事";
  if (a < 45) return "熟络搭话";
  if (a < 70) return "信得过给面子";
  return "过命自己人";
}

function fullCard(npc: Npc, stage: Stage, npcs: NpcState["npcs"] = {}): string {
  const lines = [
    `- ${label(npc, stage)} ${npc.role}；态度：${attitudeLabel(npc)}${npc.met ? "" : "；还没见过玩家角色"}`,
    // 长相和穿着分两行（用户定的，2026-11-02："长相 + 当前穿着"）；旧卡没拆时只有一行外貌
    ...appearanceLines(npc),
    `  说话：${npc.voice}`,
  ];
  if (npc.samples.length > 0) {
    lines.push(`  样本：${npc.samples.map((s) => `「${s}」`).join(" ")}`);
  }
  lines.push(`  诉求：${npc.want}`, `  底线：${npc.limit}`);
  if (npc.age !== undefined || npc.adult !== undefined || npc.entity !== undefined) {
    lines.push(
      `  已定身份事实：${npc.age !== undefined ? `${npc.age} 岁；` : ""}${npc.adult === true ? "已确认成年；" : npc.adult === false ? "未成年；" : ""}${npc.entity === "human" ? "真人" : npc.entity === "synthetic" ? "合成人" : npc.entity === "robot" ? "机器人" : "实体身份未补定"}。这些事实不代表玩家已全部获知。`,
    );
  }
  if (npc.secret) {
    lines.push(`  幕后秘密（不等于玩家或其他 NPC 已知）：${npc.secret}`);
    lines.push(
      "  揭露条件：按当前目的、利益与底线决定是否愿意说，或由具体目击、证据和通信揭露；熟悉、人情、仇怨或一次扫描都不自动公开秘密。玩家已经得知的部分仅以知识记录和已发生正文为准。",
    );
  }
  if (stage.data !== undefined && stage.now !== undefined) {
    lines.push(`  ${bodyLine(npc, stage.data, stage.now)}`);
    lines.push(
      ...behaviorChipLines(
        npc.body?.cyberware ?? [],
        npc.behaviorChips,
        cyberwareCatalog(stage.data),
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
      return `- ${label(npc, stage)} ${npc.role}；在玩家没看着的地方死了（${off.cause}），玩家角色还不知道；正文里让玩家听说或撞见时写一条 learn`;
    }
    return `- ${label(npc, stage)} ${npc.role}；已死`;
  }
  if (!npc.met) {
    return `- ${label(npc, stage)} ${npc.role}；还没见过${npc.location ? `，常在 ${npc.location}` : ""}`;
  }
  const wound =
    stage.data !== undefined && stage.now !== undefined
      ? woundNote(npc, stage.data, stage.now)
      : undefined;
  const hurt = wound ? `；${wound}` : "";
  const doing = npc.doing ? `；最近：${npc.doing.text}` : "";
  return `- ${label(npc, stage)} ${npc.role}；态度：${attitudeLabel(npc)}${npc.location ? `，最后在 ${npc.location}` : ""}${hurt}${doing}`;
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
      const where = n.location ?? n.home;
      return where !== null && where !== undefined && districtOf(where) === district;
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
