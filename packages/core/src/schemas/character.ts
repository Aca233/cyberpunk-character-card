import { z } from "zod";
import { ATTRIBUTE_LABELS, type Attribute, AttributeSchema } from "../systems/dice/schema";
import type { SaveCharacter } from "./save";

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
  ];
  return parts.filter((p) => p !== "").join("\n");
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
