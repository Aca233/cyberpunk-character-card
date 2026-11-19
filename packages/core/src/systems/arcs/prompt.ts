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

export const arcRules: RuleModule<ArcsState> = {
  id: "arcs",
  title: "心事（原作人物的个人线）",
  commands: ["arc"],
  // 首次前因可以在普通行动中自然出现，不能等已有心事或玩家说出关键词才提供抽取指令。
  when: (_state, input) => input.mode !== "ooc",
  text: `- 【心事】区分「潜在素材，前因未成立」和本存档已经发生的事。种子和原作结局不是当前事实；好感只决定愿不愿意倾诉，不让绑架、死亡、偷车或公司交易自动发生。玩家角色不是 V，不套用 V 的行动或强制复现原作流程。
- 只有本轮正文或本存档既有记录明确支持触发前因，才写 arc start，text 写实际发生的具体事实；不能照抄种子来补发生。前因未成立时不写 tell、不泄露未来结局。前因成立也不等于整段情境成立：未被本存档事实支持的受害者、动机、症状和幕后关系仍只是可能性；原作某个分支发生过，不代表本存档必须走到那里。
- 前因已成立且标「可以说起」的人，时机合适（独处、刚一起扛过事、他主动来找玩家）时由他自己提起，写 arc tell；一个人同时最多 ${ARC_OPEN_MAX} 件说出口没了的事。正文里他只说愿意说的部分，【心事】里的情况不要一口气倒出来。
- 玩家答应插手写 join，明说不管写 decline（没人管的事会自己往前走，场外推演写）。插手以后每次有实质进展写 note（${ARC_TEXT_MAX} 字以内）。
- 事情有了结果写 resolve：text 写结果，fate 写 better（比原作结局好）、canon（差不多）或 worse（更糟）。关系真的因此变了，bond 写一句新的关系笔记（${ARC_BOND_MAX} 字以内）：可以是过命的交情，也可以是暧昧或在一起，看两人一路怎么走的，不要硬凑。
- 原作的结局只是没人插手时的参考；玩家插手以后怎么走全看局面，可以和原作完全不同。人没熟到（没标「可以说起」）时，这些事只能从传闻、旁人嘴里和他的近况里透出来。
- 玩家听说或撞见场外推演写下的结果（标了「玩家还不知道」）时写 arc hear。`,
};

function details(c: ArcConcernSeed, p: ConcernProgress): string {
  return `    已成立前因：${p.onset?.text}；条件情境参考（未被记录支持的细节不能当事实）：${c.situation}；盼着：${c.hope}；可能的走向：${c.turns.join(" / ")}；原作分支参考（不是待兑现结果）：${c.canon}`;
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
    const here = present.has(seed.npc);
    const touched = seed.concerns.some((c) => concernOf(arc, c.id).onset !== null);
    if (!unlocked && !touched && !here) continue;
    const open = openConcerns(seed, arc).length;
    lines.push(
      `- ${card.name}（${seed.npc}）${!card.alive ? "，已死" : unlocked ? "" : "，还没熟到说心事"}${here ? "，在场" : ""}`,
    );
    for (const c of seed.concerns) {
      const p = concernOf(arc, c.id);
      if (p.onset === null) {
        if (here && card.alive) {
          lines.push(
            `  - ${c.id}：潜在素材，前因未成立；只有实际发生「${c.trigger}」后才可 start。`,
          );
        }
        continue;
      }
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
        if (here) lines.push(details(c, p));
        continue;
      }
      lines.push(`  - ${c.id}「${c.title}」${CONCERN_STATUS_LABELS[p.status]}${lastNotes(p)}`);
      if (here || p.status === "involved") lines.push(details(c, p));
    }
  }
  return lines.join("\n");
}

/** 场外只给相关人物的潜在前因与已登记事实，不把未发生的后续支线作为现状发出。 */
export function arcOffscreenSection(
  state: ArcsState,
  data: Data,
  selected: ReadonlySet<string>,
): string | undefined {
  const lines: string[] = [];
  for (const seed of arcCatalog(data).values()) {
    if (!selected.has(seed.npc)) continue;
    const arc = arcOf(state, seed.npc);
    for (const c of seed.concerns) {
      const p = concernOf(arc, c.id);
      if (p.status === "resolved") continue;
      lines.push(
        p.onset === null
          ? `- ${seed.npc}/${c.id}｜潜在素材，尚未发生｜必须已有前因：${c.trigger}`
          : `- ${seed.npc}/${c.id}｜已成立前因：${p.onset.text}${lastNotes(p)}；盼着：${c.hope}`,
      );
    }
  }
  return lines.length ? lines.join("\n") : undefined;
}

// 场外心事改由【城里在发酵的事】推进，这里不再单列一栏和一条规则（用户 2026-11-01 定的「全改」第 4 步）
