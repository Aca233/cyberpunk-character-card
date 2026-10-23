import { z } from "zod";
import { AttributeSchema } from "../dice";

export const AttributeValueSchema = z.number().int().min(1).max(20);

export const CharacterStateSchema = z.object({
  /** 建档前为 null */
  name: z.string().min(1).nullable(),
  /** 给主持人看的一段简介：出身、外貌、性格、会什么 */
  brief: z.string(),
  attributes: z.record(AttributeSchema, AttributeValueSchema),
  /** 街头声望等级 */
  streetCred: z.number().int().min(0).max(50),
});
export type CharacterState = z.infer<typeof CharacterStateSchema>;

/** 只能由代码发出：建档时写入角色 */
export const SetCharacterSchema = z.object({
  type: z.literal("character.set"),
  name: z.string().min(1),
  brief: z.string(),
  attributes: z.record(AttributeSchema, AttributeValueSchema),
  streetCred: z.number().int().min(0).max(50).default(1),
});
export type SetCharacter = z.infer<typeof SetCharacterSchema>;
