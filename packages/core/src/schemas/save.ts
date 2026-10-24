import { z } from "zod";
import { SetCharacterSchema } from "../systems/character/schema";
import { DifficultySchema } from "../systems/dice/schema";
import { ToleranceSchema } from "../systems/humanity/schema";

/** 开档时角色卡的快照：之后改角色卡不影响已有存档 */
export const SaveCharacterSchema = SetCharacterSchema.omit({ type: true });
export type SaveCharacter = z.infer<typeof SaveCharacterSchema>;

/** 建档时从角色主板带进来的：开局义体 id 和义体耐受 */
export const BoardStartSchema = z.object({
  cyberware: z.array(z.string().min(1)).default([]),
  tolerance: ToleranceSchema.default("normal"),
});
export type BoardStart = z.infer<typeof BoardStartSchema>;

/** 存档目录里的 meta.json */
export const SaveMetaSchema = z.object({
  title: z.string().min(1).max(80),
  characterId: z.string().min(1),
  difficulty: DifficultySchema,
  createdAt: z.string().min(1),
  /** 开场的游戏时间（从 1970-01-01 00:00 起的分钟数） */
  startTime: z.number().int(),
  /** 旧存档没有：开档时没有选角色 */
  character: SaveCharacterSchema.optional(),
  /** 旧存档没有：用的是内容包里哪个开场 */
  opening: z.string().min(1).optional(),
  /** 旧存档没有：建档时按出身和经历挑的开局行装，读档重放时照这个发 */
  loadouts: z.array(z.string().min(1)).optional(),
  /** 旧存档和没用主板的角色没有 */
  board: BoardStartSchema.optional(),
});
export type SaveMeta = z.infer<typeof SaveMetaSchema>;
