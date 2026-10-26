import type { RuleModule } from "../../kernel/system";
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
  ],
  when: () => true,
  judge: `- 对话、说服、谈判看有没有说中对方的诉求、有没有触到底线：好感决定态度冷热，诉求和底线决定会不会答应，不掷骰。
- 人物的秘密只有你知道，判断时可以用，但不写进 read。
- 死了的人不再出场。`,
  narrate: `- 每轮的【人物】里列着已有人物卡的人：在场的带完整的卡，诉求、底线和秘密只有你知道，不能直接说给玩家，只能从言行里透出来；不在场的只有一行。
- 演人物时照卡上的说话方式和样本写，口吻前后一致；样本只是参考，不照搬原句。好感决定态度的冷热，诉求和底线决定会不会答应。
- 要写新人物之前，先看【人物】里有没有合适的老面孔能用；同一个酒保、上次放走的混混可以反复出现。
- 承诺、人情、冲突这类以后会被提起的事，让人物记着、以后提起。死了的人不再出场，也不会发消息。
- 卡上的「最近」是这个人在屏幕外的近况，演的时候接着它写。时间大段跳过（半天以上）时，可以让一两个和玩家有关的人有点离屏进展，借新闻、传闻、一条消息或者本人的一句话透出来；只写一两句，不替玩家做事。
- 卡上的「玩家角色知道」是玩家角色已经知道的这个人的事；角色只按这些和亲眼看到的说话行事，没打听过的身份、来历、秘密不能写成角色知道。`,
  text: `- 每轮的【人物】里列着已有人物卡的人：在场的带完整的卡，诉求、底线和秘密只有你知道，不能直接说给玩家，只能从言行里透出来；不在场的只有一行。
- 演人物时照卡上的说话方式和样本写，口吻前后一致；样本只是参考，不照搬原句。好感决定态度的冷热，诉求和底线决定会不会答应。
- 要写新人物之前，先看【人物】里有没有合适的老面孔能用；同一个酒保、上次放走的混混可以反复出现。
- 人物出场、或者第一次见面，写一条 meet；有名字、并且和玩家角色有了实质互动的新人物，当场用 npc 建卡，id 用小写拼音或英文。路人不建卡。
- 好感只在对方真的有理由改变态度时才写，一轮里同一个人最多一条；承诺、人情、冲突这类以后会被提起的事写一条 memory。
- 正文透出某个有卡的人最近在做什么（本人说起、新闻、传闻、消息），写一条 doing，会替换旧的；正文没写到的不记。
- 关系真的变了（一起扛过事、说过真心话、生死与共，或者背叛、被拆穿大谎、伤了对方在乎的人）才写一条 relation，一句话写现在的关系，会替换旧的；好感高只说明对方愿意见你，不等于关系深。
- 欠下或结下以后会被讨回来的人情和仇，写一条 ledger（owesYou 对方欠玩家角色、youOwe 玩家角色欠对方、grudge 对方记玩家角色的仇）；还了、报了、放下了，写 ledgerSettle，entry 填卡上「人情和仇」那一条的编号。
- 死了的人不再出场，也不会发消息。
- 卡上的「玩家角色知道」是玩家角色已经知道的这个人的事；角色只按这些和亲眼看到的说话行事，没打听过的身份、来历、秘密不能写成角色知道。正文里角色得知了有卡的人的一件事（本人说起、别人提到、传闻新闻、扫描），写一条 learn，照角色以为的写，骗人的话照骗的写；卡上已经有的不再写。`,
};

export interface Stage {
  /** 玩家角色所在的地点 id */
  readonly location: string | null;
  /** 当前场景开始的游戏时间；这一场里出过场的人算在场 */
  readonly sceneStartedAt: number;
}

export function onStage(npc: Npc, stage: Stage): boolean {
  if (!npc.alive) return false;
  if (stage.location !== null && npc.location === stage.location) return true;
  return npc.lastSeenAt !== null && npc.lastSeenAt >= stage.sceneStartedAt;
}

function label(npc: Npc): string {
  return `${npc.name}${npc.alias ? `（外号${npc.alias}）` : ""}［${npc.id}，${npc.pronoun}］`;
}

function fullCard(npc: Npc): string {
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

function oneLine(npc: Npc): string {
  if (!npc.alive) return `- ${label(npc)} ${npc.role}；已死`;
  if (!npc.met) {
    return `- ${label(npc)} ${npc.role}；还没见过${npc.location ? `，常在 ${npc.location}` : ""}`;
  }
  const doing = npc.doing ? `；最近：${npc.doing.text}` : "";
  return `- ${label(npc)} ${npc.role}；好感 ${npc.affinity}${npc.location ? `，最后在 ${npc.location}` : ""}${doing}`;
}

/** 给模型看的【人物】：在场的人带完整的卡，其余每人一行 */
export function castSection(state: NpcState, stage: Stage): string {
  const all = Object.values(state.npcs);
  if (all.length === 0) return "还没有人物卡。";
  const here = all.filter((n) => onStage(n, stage));
  const away = all
    .filter((n) => !onStage(n, stage))
    .sort((a, b) => (b.lastSeenAt ?? -1) - (a.lastSeenAt ?? -1))
    .slice(0, OFFSTAGE_LISTED);
  const parts: string[] = [];
  parts.push(here.length > 0 ? `在场：\n${here.map(fullCard).join("\n")}` : "在场：没有有卡的人。");
  if (away.length > 0) parts.push(`不在场：\n${away.map(oneLine).join("\n")}`);
  return parts.join("\n");
}
