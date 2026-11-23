import { z } from "zod";

export const IMAGE_PROMPT_MAX_LENGTH = 24000;
export const IMAGE_NEGATIVE_PROMPT_MAX_LENGTH = 10000;
export const IMAGE_STYLE_FIELD_MAX_LENGTH = 20000;
export const IMAGE_AUX_SYSTEM_PROMPT_MAX_LENGTH = 100000;
export const IMAGE_SCENE_MAX_LENGTH = 60000;
export const IMAGE_INSTRUCTION_MAX_LENGTH = 8000;

/** 外貌、服装、伤势分别保留；装备/义体是参考资料，不表示全部可见或正在使用。 */
export const ImageCharacterReferenceSchema = z.object({
  id: z.string().min(1).max(160),
  name: z.string().max(120),
  alias: z.string().max(120).default(""),
  pronoun: z.string().max(20).default(""),
  role: z.string().max(300).default(""),
  look: z.string().max(2000).default(""),
  outfit: z.string().max(2000).default(""),
  wounds: z.string().max(2000).default(""),
  cyberware: z.array(z.string().max(240)).max(32).default([]),
  gear: z.array(z.string().max(240)).max(32).default([]),
});
export type ImageCharacterReference = z.infer<typeof ImageCharacterReferenceSchema>;

/** 一轮结算时固定下来的视觉资料，不从之后的世界状态重新补写。正文由该轮记录提供。 */
export const ImageSceneContextSchema = z.object({
  location: z.string().max(300),
  district: z.string().max(160),
  timeText: z.string().max(160),
  weather: z.string().max(160),
  characters: z.array(ImageCharacterReferenceSchema).max(32),
});
export type ImageSceneContext = z.infer<typeof ImageSceneContextSchema>;
