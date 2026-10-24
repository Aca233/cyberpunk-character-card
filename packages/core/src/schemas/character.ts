import { z } from "zod";
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
    /** 过往：几段经历 */
    past: text(800).default(""),
    personality: text(300).default(""),
    /** 说话方式：口头禅、语气 */
    voice: text(300).default(""),
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

/** 开档时写进存档的角色快照 */
export function saveCharacter(card: CharacterCard): SaveCharacter {
  return {
    name: card.name,
    brief: characterBrief(card),
    attributes: { ...card.attributes },
    streetCred: 1,
  };
}
