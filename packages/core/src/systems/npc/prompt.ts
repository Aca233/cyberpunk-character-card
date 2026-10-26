import type { RuleModule } from "../../kernel/system";
import { bodyLine, woundNote } from "./body";
import { KNOWN_SOURCE_LABELS, type LedgerKind, type Npc, type NpcState } from "./schema";

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
    "meet",
    "affinity",
    "memory",
    "npcDeath",
    "doing",
    "relation",
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
  judge: `- 对话、说服、谈判看有没有说中对方的诉求、有没有触到底线：好感决定态度冷热，诉求和底线决定会不会答应，不掷骰。
- 人物的秘密只有你知道，判断时可以用，但不写进 read。
- 有卡的人能做到什么看卡上的「身体」：属性、装备和义体决定他的本事，伤势重了就做不了吃力的事，倒下了什么也做不了。
- 死了的人不再出场。`,
  narrate: `- 每轮的【人物】里列着已有人物卡的人：在场的带完整的卡，诉求、底线和秘密只有你知道，不能直接说给玩家，只能从言行里透出来；不在场的只有一行。
- 演人物时照卡上的说话方式和样本写，口吻前后一致；样本只是参考，不照搬原句。好感决定态度的冷热，诉求和底线决定会不会答应。
- 要写新人物之前，先看【人物】里「这一带的老面孔」和不在场的人有没有合适的能用；同一个酒保、总被撞见的混混、上次放走的人可以反复出现，让他们出场写 meet，不要另建一张差不多的卡。
- 承诺、人情、冲突这类以后会被提起的事，让人物记着、以后提起。死了的人不再出场，也不会发消息。
- 卡上的「最近」是这个人在屏幕外的近况，演的时候接着它写。时间大段跳过（半天以上）时，可以让一两个和玩家有关的人有点离屏进展，借新闻、传闻、一条消息或者本人的一句话透出来；只写一两句，不替玩家做事。
- 卡上的「玩家角色知道」是玩家角色已经知道的这个人的事；角色只按这些和亲眼看到的说话行事，没打听过的身份、来历、秘密不能写成角色知道。
- 卡上的「身体」是这个人的档位、属性、生命和伤势、装备、义体和人性：打起来按属性和装备写他的本事，受了伤照伤势写。人性数值和阶段只有你知道，不直接说给玩家；人性低了从言行里透出征兆（手抖、说话变冷、嗑药、对义体着魔），队员也会发作，可能走上大卫那条路，人性到 0 怎么收场按剧情处理。`,
  text: `- 每轮的【人物】里列着已有人物卡的人：在场的带完整的卡，诉求、底线和秘密只有你知道，不能直接说给玩家，只能从言行里透出来；不在场的只有一行。
- 演人物时照卡上的说话方式和样本写，口吻前后一致；样本只是参考，不照搬原句。好感决定态度的冷热，诉求和底线决定会不会答应。
- 要写新人物之前，先看【人物】里「这一带的老面孔」和不在场的人有没有合适的能用；同一个酒保、总被撞见的混混、上次放走的人可以反复出现，让他们出场写 meet，不要另建一张差不多的卡。
- 人物出场、或者第一次见面，写一条 meet；有名字、并且和玩家角色有了实质互动的新人物，当场用 npc 建卡，id 用小写拼音或英文。路人不建卡。
- 用 npc 建卡时可以带 body：tier 按身份选（mook 普通人、pro 老手、elite 精英、legend 传奇），属性、装备和义体要符合身份，装备和义体写物品表、义体表里的 id；不写按普通人的默认值补。
- 好感只在对方真的有理由改变态度时才写，一轮里同一个人最多一条；承诺、人情、冲突这类以后会被提起的事写一条 memory。
- 正文透出某个有卡的人最近在做什么（本人说起、新闻、传闻、消息），写一条 doing，会替换旧的；正文没写到的不记。
- 关系真的变了（一起扛过事、说过真心话、生死与共，或者背叛、被拆穿大谎、伤了对方在乎的人）才写一条 relation，一句话写现在的关系，会替换旧的；好感高只说明对方愿意见你，不等于关系深。
- 欠下或结下以后会被讨回来的人情和仇，写一条 ledger（owesYou 对方欠玩家角色、youOwe 玩家角色欠对方、grudge 对方记玩家角色的仇）；还了、报了、放下了，写 ledgerSettle，entry 填卡上「人情和仇」那一条的编号。
- 死了的人不再出场，也不会发消息。
- 卡上的「玩家角色知道」是玩家角色已经知道的这个人的事；角色只按这些和亲眼看到的说话行事，没打听过的身份、来历、秘密不能写成角色知道。正文里角色得知了有卡的人的一件事（本人说起、别人提到、传闻新闻、扫描），写一条 learn，照角色以为的写，骗人的话照骗的写；卡上已经有的不再写。
- 有卡的人受了伤写 npcHurt（tier 和玩家的伤害档一样），得到治疗写 npcHeal；打到倒下的只有义体医生能救，死了另写 npcDeath。打斗里有卡敌人受伤，combat 的 foe 之外同时写 npcHurt；玩家角色扫描了有卡的人（包括 combat 的 scan）写 npcScan。
- 有卡的人拿到或丢了武器、换了衣服写 npcGear，装上或拆掉义体写 npcChrome；玩家角色出钱给队员买装备、装义体，同时写 money 扣钱。
- 有卡的人做了残忍的事、失去了重要的人、或者好好休整了一阵，写 npcHumanity，只选档位不写数字；不出提示条，玩家只从正文里的征兆看出来。`,
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
}

/** 「这一带的老面孔」最多列这么多个，见过的、最近出场的优先 */
export const LOCALS_LISTED = 8;

export function onStage(npc: Npc, stage: Stage): boolean {
  if (!npc.alive) return false;
  if (stage.location !== null && npc.location === stage.location) return true;
  return npc.lastSeenAt !== null && npc.lastSeenAt >= stage.sceneStartedAt;
}

function label(npc: Npc): string {
  return `${npc.name}${npc.alias ? `（外号${npc.alias}）` : ""}［${npc.id}，${npc.pronoun}］`;
}

function fullCard(npc: Npc, stage: Stage): string {
  const lines = [
    `- ${label(npc)} ${npc.role}；好感 ${npc.affinity}${npc.met ? "" : "；还没见过玩家角色"}`,
    `  外貌：${npc.look}`,
    `  说话：${npc.voice}`,
  ];
  if (npc.samples.length > 0) {
    lines.push(`  样本：${npc.samples.map((s) => `「${s}」`).join(" ")}`);
  }
  lines.push(`  诉求：${npc.want}`, `  底线：${npc.limit}`);
  if (npc.secret) lines.push(`  秘密：${npc.secret}`);
  if (stage.data !== undefined && stage.now !== undefined) {
    lines.push(`  ${bodyLine(npc, stage.data, stage.now)}`);
  }
  if (npc.relation) lines.push(`  关系：${npc.relation.text}`);
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
  return lines.join("\n");
}

function oneLine(npc: Npc, stage: Stage): string {
  if (!npc.alive) return `- ${label(npc)} ${npc.role}；已死`;
  if (!npc.met) {
    return `- ${label(npc)} ${npc.role}；还没见过${npc.location ? `，常在 ${npc.location}` : ""}`;
  }
  const wound =
    stage.data !== undefined && stage.now !== undefined
      ? woundNote(npc, stage.data, stage.now)
      : undefined;
  const hurt = wound ? `；${wound}` : "";
  const doing = npc.doing ? `；最近：${npc.doing.text}` : "";
  return `- ${label(npc)} ${npc.role}；好感 ${npc.affinity}${npc.location ? `，最后在 ${npc.location}` : ""}${hurt}${doing}`;
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
      ? `在场：\n${here.map((n) => fullCard(n, stage)).join("\n")}`
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
