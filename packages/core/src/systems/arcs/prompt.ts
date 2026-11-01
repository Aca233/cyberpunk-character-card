import type { RuleModule } from "../../kernel/system";
import type { Npc } from "../npc";
import { formatGameTime } from "../world";
import { arcCatalog, arcOf, arcUnlocked, concernOf, openConcerns } from "./apply";
import {
  ARC_BOND_MAX,
  ARC_OPEN_MAX,
  ARC_TEXT_MAX,
  type ArcConcernSeed,
  type ArcsState,
  CONCERN_FATE_LABELS,
  CONCERN_STATUS_LABELS,
  type ConcernProgress,
} from "./schema";

type Data = Readonly<Record<string, unknown>>;

const WORDS = /心事|个人线/;

export const arcRules: RuleModule<ArcsState> = {
  id: "arcs",
  title: "心事（原作人物的个人线）",
  commands: ["arc"],
  when: (state, input) =>
    input.mode !== "ooc" && (Object.keys(state.arcs).length > 0 || WORDS.test(input.text)),
  text: `- 【心事】列的是原作人物自己身上压着的事：他碰上了什么、想要什么、这件事可能怎么走、原作里落在他身上的结局。玩家角色不是 V：不要把原作里 V 的行动、台词、任务步骤套给玩家，也不要替玩家决定管不管、怎么管。
- 标「可以说起」的人，时机合适（独处、刚一起扛过事、他主动来找玩家）时由他自己提起，写 arc tell；一个人同时最多 ${ARC_OPEN_MAX} 件说出口没了的事。正文里他只说愿意说的部分，【心事】里的情况不要一口气倒出来。
- 玩家答应插手写 join，明说不管写 decline（没人管的事会自己往前走，场外推演写）。插手以后每次有实质进展写 note（${ARC_TEXT_MAX} 字以内）。
- 事情有了结果写 resolve：text 写结果，fate 写 better（比原作结局好）、canon（差不多）或 worse（更糟）。关系真的因此变了，bond 写一句新的关系笔记（${ARC_BOND_MAX} 字以内）：可以是过命的交情，也可以是暧昧或在一起，看两人一路怎么走的，不要硬凑。
- 原作的结局只是没人插手时的参考；玩家插手以后怎么走全看局面，可以和原作完全不同。人没熟到（没标「可以说起」）时，这些事只能从传闻、旁人嘴里和他的近况里透出来。
- 玩家听说或撞见场外推演写下的结果（标了「玩家还不知道」）时写 arc hear。`,
};

function details(c: ArcConcernSeed): string {
  return `    情况：${c.situation}；盼着：${c.hope}；可能的走向：${c.turns.join(" / ")}；原作结局：${c.canon}`;
}

function lastNotes(p: ConcernProgress): string {
  const notes = p.notes
    .slice(-2)
    .map((n) => `${formatGameTime(n.at)} ${n.text}${n.by === "offscreen" ? "（场外）" : ""}`);
  return notes.length > 0 ? `；进展：${notes.join("；")}` : "";
}

/**
 * 给叙事模型的【心事】：解锁了或已经有动静的人，每件心事的状态和进展；
 * 在场的人和玩家在管的事带上情况、希望、可能的走向和原作结局
 */
export function arcSection(
  state: ArcsState,
  data: Data,
  npcs: Readonly<Record<string, Npc>>,
  present: ReadonlySet<string>,
): string {
  const lines: string[] = [];
  for (const seed of arcCatalog(data).values()) {
    const card = npcs[seed.npc];
    if (!card) continue;
    const arc = arcOf(state, seed.npc);
    const unlocked = arcUnlocked(state, seed, card);
    const touched = seed.concerns.some(
      (c) => concernOf(arc, c.id).notes.length > 0 || concernOf(arc, c.id).status !== null,
    );
    if (!unlocked && !touched) continue;
    const here = present.has(seed.npc);
    const open = openConcerns(seed, arc).length;
    lines.push(
      `- ${card.name}（${seed.npc}）${!card.alive ? "，已死" : unlocked ? "" : "，还没熟到说心事"}${here ? "，在场" : ""}`,
    );
    for (const c of seed.concerns) {
      const p = concernOf(arc, c.id);
      if (p.status === "resolved" && p.outcome) {
        lines.push(
          `  - ${c.id}「${c.title}」有了结果（${CONCERN_FATE_LABELS[p.outcome.fate]}${p.outcome.known ? "" : "，玩家还不知道"}）：${p.outcome.text}`,
        );
        continue;
      }
      if (p.status === null) {
        const canTell = unlocked && card.alive && open < ARC_OPEN_MAX;
        lines.push(
          `  - ${c.id}「${c.title}」还没说出口${canTell ? "，可以说起" : ""}${lastNotes(p)}`,
        );
        if (here && canTell) lines.push(details(c));
        continue;
      }
      lines.push(`  - ${c.id}「${c.title}」${CONCERN_STATUS_LABELS[p.status]}${lastNotes(p)}`);
      if (here || p.status === "involved") lines.push(details(c));
    }
  }
  return lines.join("\n");
}

// 场外心事改由【城里在发酵的事】推进，这里不再单列一栏和一条规则（用户 2026-11-01 定的「全改」第 4 步）
