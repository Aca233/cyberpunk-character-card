import { z } from "zod";
import type { Trait } from "../systems/character/schema";
import { ATTRIBUTE_LABELS, type Attribute, AttributeSchema } from "../systems/dice/schema";
import {
  BOARD_SLOT_LABELS,
  type Board,
  BoardSchema,
  boardBrief,
  boardIssues,
  boardModules,
} from "./board";
import type { BoardStart, SaveCharacter } from "./save";

/** 创建时各项属性从这个值起步 */
export const ATTRIBUTE_BASE = 3;
/** 创建时可以额外分配的属性点 */
export const ATTRIBUTE_POINTS = 7;
/** 创建时单项最高 */
export const ATTRIBUTE_CREATE_MAX = 6;

const text = (max: number) => z.string().trim().max(max);

/** 角色正文的区块：都可以交给模型生成、重写、续写、润色，也可以手写和锁定 */
export const PROSE_BLOCKS = [
  "look",
  "past",
  "personality",
  "voice",
  "scene",
  "greeting",
  "examples",
] as const;
export const ProseBlockSchema = z.enum(PROSE_BLOCKS);
export type ProseBlock = z.infer<typeof ProseBlockSchema>;

export const PROSE_BLOCK_INFO: Readonly<
  Record<ProseBlock, { readonly label: string; readonly max: number; readonly hint: string }>
> = {
  look: { label: "外貌", max: 300, hint: "衣着、神态、义体的样子、留下的伤疤" },
  past: { label: "背景故事", max: 800, hint: "从哪来，失去过什么，还有什么没了结" },
  personality: { label: "性格", max: 300, hint: "在乎什么，忍不了什么，习惯把什么藏起来" },
  voice: { label: "说话方式", max: 300, hint: "口头禅、语气、爱用的词" },
  scene: { label: "场景", max: 400, hint: "故事开始时角色身在何处、处境如何" },
  greeting: { label: "开场白", max: 600, hint: "角色登场的一段描写，可以带一句台词" },
  examples: { label: "对话示例", max: 800, hint: "几句这个角色会说的话，一句一行，用来定口吻" },
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
    /** 场景、开场白、对话示例：只留在卡上，不交给主持人，免得它替玩家说话 */
    scene: text(400).default(""),
    greeting: text(600).default(""),
    examples: text(800).default(""),
    /** 锁定的正文区块：模型不会改写，生成别的区块时当作定稿 */
    locked: z.array(ProseBlockSchema).max(PROSE_BLOCKS.length).default([]),
    /** 本事：会什么、不会什么 */
    skills: text(400).default(""),
    attributes: z.record(
      AttributeSchema,
      z.number().int().min(ATTRIBUTE_BASE).max(ATTRIBUTE_CREATE_MAX),
    ),
    /** 角色主板；只写了文字的旧卡没有 */
    board: BoardSchema.optional(),
  })
  .superRefine((card, ctx) => {
    const spent = pointsSpent(card.attributes);
    if (spent > ATTRIBUTE_POINTS) {
      ctx.addIssue({
        code: "custom",
        path: ["attributes"],
        message: `属性点只有 ${ATTRIBUTE_POINTS} 点，现在分了 ${spent} 点`,
      });
    }
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

export function pointsSpent(attributes: Readonly<Partial<Record<Attribute, number>>>): number {
  return (Object.keys(ATTRIBUTE_LABELS) as Attribute[]).reduce(
    (sum, a) => sum + (attributes[a] ?? ATTRIBUTE_BASE) - ATTRIBUTE_BASE,
    0,
  );
}

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

/** 挑开局行装看的文字：手写的出身、过往、本事，加上主板模块的名字和标签 */
export function loadoutText(card: CharacterCard): { origin: string; past: string; skills: string } {
  return {
    origin: [card.origin, boardWords(card.board, "origin")].join(" "),
    past: [card.past, boardWords(card.board, "pasts")].join("\n"),
    skills: [card.skills, boardWords(card.board, "skills")].join("\n"),
  };
}

const UNDECIDED = "还没定：第一次出场时按身份和那段经历定下来，之后一直保持一致";

/** 主板模块带出的人物：过去就认识，外貌和口吻留给第一次出场时定；负面经历带出的人开局有敌意 */
export function boardPeople(board: Board): BoardStart["people"] {
  const people: BoardStart["people"] = [];
  const names = new Set<string>();
  for (const m of boardModules(board)) {
    m.people.forEach((p, i) => {
      if (names.has(p.name)) return;
      names.add(p.name);
      const base =
        m.id
          .toLowerCase()
          .replace(/[^a-z0-9-]+/g, "-")
          .replace(/^-+|-+$/g, "") || "m";
      const flaw = m.slot === "flaw";
      people.push({
        id: `board-${base}-${i + 1}`,
        name: p.name,
        pronoun: "TA",
        role: (p.role || `${BOARD_SLOT_LABELS[m.slot]}「${m.label}」里的人`).slice(0, 40),
        look: UNDECIDED,
        voice: UNDECIDED,
        samples: [],
        want: (
          `和玩家角色的旧账：${BOARD_SLOT_LABELS[m.slot]}「${m.label}」` +
          (m.hook ? `——${m.hook}` : m.ability ? `——${m.ability}` : "")
        ).slice(0, 160),
        limit: "有自己的生活和打算，不会为了玩家角色无条件冒险",
        canon: false,
        affinity: flaw ? -10 : 0,
        met: true,
      });
    });
  }
  return people;
}

/** 建档时从主板带进存档的东西：开局义体、义体耐受和模块带出的人物 */
export function boardStart(card: CharacterCard): BoardStart | undefined {
  if (!card.board) return undefined;
  return {
    cyberware: card.board.cyberware.map((c) => c.id),
    tolerance: card.board.tolerance,
    people: boardPeople(card.board),
  };
}

/** 主板上的模块和联动，记进角色状态：专属选项的来源按它核对 */
export function boardTraits(board: Board): Trait[] {
  return [
    ...boardModules(board).map((m) => ({ slot: m.slot, label: m.label, ability: m.ability })),
    ...board.combos.map((c) => ({ slot: "combo" as const, label: c.label, ability: c.ability })),
  ];
}

/** 开档时写进存档的角色快照 */
export function saveCharacter(card: CharacterCard): SaveCharacter {
  return {
    name: card.name,
    brief: characterBrief(card),
    attributes: { ...card.attributes },
    streetCred: 1,
    ...(card.board ? { traits: boardTraits(card.board) } : {}),
  };
}
