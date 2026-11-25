import { z } from "zod";
import type { Trait } from "../systems/character/schema";
import { NO_FACTION, NPC_UNDECIDED_PREFIX } from "../systems/npc/schema";
import {
  type Acquaintance,
  BOARD_SLOT_LABELS,
  type Board,
  BoardSchema,
  boardBrief,
  boardIssues,
  boardModules,
  RELATION_INFO,
} from "./board";
import type { BoardStart, SaveCharacter, StartAcquaintance } from "./save";

const text = (max: number) => z.string().trim().max(max);

/** 角色正文的区块：都可以交给模型生成、重写、续写、润色，也可以手写和锁定 */
export const PROSE_BLOCKS = ["look", "past", "personality", "voice"] as const;
export const ProseBlockSchema = z.enum(PROSE_BLOCKS);
export type ProseBlock = z.infer<typeof ProseBlockSchema>;

export const PROSE_BLOCK_INFO: Readonly<
  Record<ProseBlock, { readonly label: string; readonly max: number; readonly hint: string }>
> = {
  look: {
    label: "外貌",
    max: 300,
    hint: "体态轮廓、五官神态、发型瞳色、外显义体与伤疤纹身等物理体貌",
  },
  past: { label: "背景故事", max: 800, hint: "生平来历、重大转折经历、失去的事物与未了恩怨" },
  personality: { label: "性格", max: 300, hint: "价值信条、行事底线、高压下的真实反应与深层软肋" },
  voice: { label: "说话方式", max: 300, hint: "语速语气、口头禅、惯用黑话与特定情境下的腔调" },
};

/** 玩家自己写的角色卡；开档时整理成一段简介交给模型 */
export const CharacterCardSchema = z
  .object({
    name: z.string().trim().min(1, "名字不能为空").max(20, "名字最多 20 字"),
    alias: text(20).default(""),
    /** 他、她、TA */
    pronoun: z.string().trim().min(1).max(4).default("TA"),
    /** 出身，例如街头小子、流浪者、公司员工 */
    origin: z.string().trim().min(1, "出身不能为空").max(40),
    look: text(300).default(""),
    /** 过往：几段经历，也是正文里的背景故事 */
    past: text(800).default(""),
    personality: text(300).default(""),
    /** 说话方式：口头禅、语气 */
    voice: text(300).default(""),
    /** 锁定的正文区块：模型不会改写，生成别的区块时当作定稿 */
    locked: z.array(ProseBlockSchema).max(PROSE_BLOCKS.length).default([]),
    /** 本事：会什么、不会什么 */
    skills: text(400).default(""),
    /** 角色主板；只写了文字的旧卡没有 */
    board: BoardSchema.optional(),
    /** 本地生成的角色立绘 ID（存在浏览器 ImageStore） */
    portrait: z.string().trim().min(1).max(120).optional(),
  })
  .superRefine((card, ctx) => {
    for (const message of card.board ? boardIssues(card.board) : []) {
      ctx.addIssue({ code: "custom", path: ["board"], message });
    }
  });
export type CharacterCard = z.infer<typeof CharacterCardSchema>;

/** 存在本地的角色卡 */
export const StoredCharacterSchema = z.object({
  id: z.string().min(1),
  updatedAt: z.string().min(1),
  card: CharacterCardSchema,
});
export type StoredCharacter = z.infer<typeof StoredCharacterSchema>;

/** 把角色卡整理成给模型看的简介 */
export function characterBrief(card: CharacterCard): string {
  const parts = [
    `${card.pronoun}${card.alias ? `，外号${card.alias}` : ""}，出身：${card.origin}`,
    card.look && `外貌：${card.look}`,
    card.past && `过往：${card.past}`,
    card.personality && `性格：${card.personality}`,
    card.voice && `说话方式：${card.voice}`,
    card.skills && `本事：${card.skills}`,
    card.board ? boardBrief(card.board) : "",
  ];
  return parts.filter((p) => p !== "").join("\n");
}

function boardWords(board: Board | undefined, key: "origin" | "pasts" | "skills"): string {
  if (!board) return "";
  const list = key === "origin" ? (board.origin ? [board.origin] : []) : board[key];
  return list.flatMap((m) => [m.label, ...m.tags]).join(" ");
}

/** 挑开局行装看的文字：手写的出身、过往、本事，加上主板模块的名字、标签与准确出身 id */
export function loadoutText(card: CharacterCard): {
  originId?: string;
  origin: string;
  past: string;
  skills: string;
} {
  return {
    ...(card.board?.origin ? { originId: card.board.origin.id } : {}),
    origin: [card.origin, boardWords(card.board, "origin")].join(" "),
    past: [card.past, boardWords(card.board, "pasts")].join("\n"),
    skills: [card.skills, boardWords(card.board, "skills")].join("\n"),
  };
}

const UNDECIDED = `${NPC_UNDECIDED_PREFIX}第一次出场时按身份和那段经历定下来，之后一直保持一致`;

function safeNpcId(raw: string, used: ReadonlySet<string>): string {
  const base =
    raw
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "custom-npc";
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

function isCustomAcquaintance(a: Acquaintance): boolean {
  return (
    !a.catalogNpc && (Boolean(a.custom) || a.id.startsWith("custom-") || a.id.startsWith("wk-"))
  );
}

/** 主板模块带出的人物：过去就认识，外貌和口吻留给第一次出场时定；负面经历带出的人开局有敌意 */
export function boardPeople(board: Board): BoardStart["people"] {
  const people: BoardStart["people"] = [];
  const names = new Set<string>();
  const usedIds = new Set<string>();
  for (const m of boardModules(board)) {
    m.people.forEach((p, i) => {
      if (names.has(p.name)) return;
      names.add(p.name);
      const id = safeNpcId(`board-${m.id}-${i + 1}`, usedIds);
      usedIds.add(id);
      const flaw = m.slot === "flaw";
      const role = (p.role || `${BOARD_SLOT_LABELS[m.slot]}「${m.label}」里的人`).slice(0, 40);
      people.push({
        id,
        name: p.name,
        pronoun: "TA",
        role,
        // 所属势力（用户 2026-10-31："npc加个所属势力 没有就填无"）：模块里没写，按不属于任何势力
        faction: NO_FACTION,
        look: UNDECIDED,
        voice: UNDECIDED,
        samples: [],
        want: (
          `和玩家角色的旧账：${BOARD_SLOT_LABELS[m.slot]}「${m.label}」` +
          (m.hook ? `——${m.hook}` : m.ability ? `——${m.ability}` : "")
        ).slice(0, 160),
        limit: "有自己的生活和打算，不会为了玩家角色无条件冒险",
        body: { gear: [], cyberware: [] },
        canon: false,
        ...(flaw ? { relation: `旧账：${m.label}`.slice(0, 60) } : {}),
        met: true,
        ledger: [],
      });
    });
  }
  // 捏人给模块带出的人改过关系的，按关系表盖过上面的默认关系
  const seeded = people.map((p) => {
    const a = board.acquaintances.find((x) => x.id === p.id);
    return a ? { ...p, ...acquaintanceSeed(a) } : p;
  });
  // 创意工坊/自定义旧识兜底：规范化 id 后凭自包含快照生成局内人物卡
  for (const a of board.acquaintances) {
    if (isCustomAcquaintance(a) && !seeded.some((p) => p.id === a.id || p.name === a.name)) {
      const id = safeNpcId(a.id, usedIds);
      usedIds.add(id);
      const seed = acquaintanceSeed(a);
      const role = (a.role || "夜之城旧识").slice(0, 40);
      seeded.push({
        ...seed,
        id,
        name: a.name,
        pronoun: "TA",
        role,
        faction: NO_FACTION,
        look: UNDECIDED,
        voice: UNDECIDED,
        samples: [],
        want: (a.note ? `和玩家角色的旧事：${a.note}` : "在夜之城按自己的信条活下去").slice(0, 160),
        limit: "有自己的生活和打算，不会为了玩家角色无条件冒险",
        body: { gear: [], cyberware: [] },
        canon: false,
        met: true,
      });
    }
  }
  return seeded;
}

/**
 * 一个旧识按关系表换成开局的关系笔记与人情/仇怨账本。
 * "是什么事"没写时，关系笔记写关系名，人情和仇写一句占位，叙事模型第一次提起时再定细节
 */
export function acquaintanceSeed(a: Acquaintance): StartAcquaintance {
  const info = RELATION_INFO[a.relation];
  const note = a.note.trim();
  const relation =
    info.note || (!info.ledger && note) ? (note ? `${info.label}：${note}` : info.label) : "";
  return {
    id: a.id,
    ...(relation ? { relation: relation.slice(0, 60) } : {}),
    ledger: info.ledger
      ? [
          {
            kind: info.ledger,
            text: (note || `${info.label}：开局以前的旧事，细节第一次提起时再定`).slice(0, 80),
          },
        ]
      : [],
  };
}

/** 建档时从主板带进存档的东西：开局义体、自定义义体快照、开局行装定制、模块带出的人物和原作人物旧识 */
export function boardStart(card: CharacterCard): BoardStart | undefined {
  if (!card.board) return undefined;
  const people = boardPeople(card.board);
  const customCyberware = card.board.cyberware.filter((c) => Boolean(c.custom && c.slot));
  return {
    cyberware: card.board.cyberware.map((c) => c.id),
    customCyberware,
    ...(card.board.origin ? { origin: card.board.origin.id } : {}),
    ...(card.board.kit ? { kit: card.board.kit } : {}),
    people,
    // 模块带出的人和自定义旧识已经在 people 里按关系处理过；剩下的是原作人物，由 newGameWorld 盖到原作人物卡上
    acquaintances: card.board.acquaintances
      .filter((a) => !isCustomAcquaintance(a) && !people.some((p) => p.id === a.id))
      .map(acquaintanceSeed),
  };
}

/**
 * 旧识里对不上人的去掉（原作人物表里没有、带出这个人的模块已经拔掉），名字按原表重写；
 * 自定义/创意工坊旧识（custom 为 true）原样保留。
 */
export function pruneAcquaintances(
  board: Board,
  canon: readonly { readonly id: string; readonly name: string }[],
): Board {
  const names = new Map<string, string>([
    ...canon.map((n) => [n.id, n.name] as const),
    ...boardPeople(board).map((p) => [p.id, p.name] as const),
  ]);
  const acquaintances = board.acquaintances.flatMap((a) => {
    if (a.custom || a.id.startsWith("custom-") || a.id.startsWith("wk-")) return [a];
    const name = names.get(a.id);
    return name ? [{ ...a, name }] : [];
  });
  return { ...board, acquaintances };
}

/** 主板上的模块，记进角色状态：专属选项的来源按它核对 */
export function boardTraits(board: Board): Trait[] {
  return boardModules(board).map((m) => ({ slot: m.slot, label: m.label, ability: m.ability }));
}

/** 开档时写进存档的角色快照 */
export function saveCharacter(card: CharacterCard): SaveCharacter {
  return {
    name: card.name,
    brief: characterBrief(card),
    visual: { alias: card.alias, pronoun: card.pronoun, look: card.look },
    ...(card.board ? { traits: boardTraits(card.board) } : {}),
    ...(card.portrait ? { portrait: card.portrait } : {}),
  };
}
