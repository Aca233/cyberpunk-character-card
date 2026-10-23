import { z } from "zod";
import { DifficultySchema } from "../systems/dice/schema";

/** 存档目录里的 meta.json */
export const SaveMetaSchema = z.object({
  title: z.string().min(1).max(80),
  characterId: z.string().min(1),
  difficulty: DifficultySchema,
  createdAt: z.string().min(1),
});
export type SaveMeta = z.infer<typeof SaveMetaSchema>;
