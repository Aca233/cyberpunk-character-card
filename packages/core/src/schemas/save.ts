import { z } from "zod";
import { DifficultySchema } from "../systems/dice/schema";

/** 存档目录里的 meta.json */
export const SaveMetaSchema = z.object({
  title: z.string().min(1).max(80),
  characterId: z.string().min(1),
  difficulty: DifficultySchema,
  createdAt: z.string().min(1),
  /** 开场的游戏时间（从 1970-01-01 00:00 起的分钟数） */
  startTime: z.number().int(),
});
export type SaveMeta = z.infer<typeof SaveMetaSchema>;
