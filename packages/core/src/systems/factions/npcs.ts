import { z } from "zod";

/**
 * 只读取人物切片里与势力联动相关的最小字段（id、名字、身份、所属势力、生死、见过与否、好感），
 * 避免与 npc 系统产生入口级循环引用。
 */
const NpcRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string().default(""),
  faction: z.string().default("none"),
  alive: z.boolean().default(true),
  met: z.boolean().default(false),
});

const NpcSliceLiteSchema = z
  .object({
    npcs: z.record(z.string(), NpcRefSchema).default({}),
  })
  .catch({ npcs: {} });

export type FactionNpcRef = z.infer<typeof NpcRefSchema>;

export function readNpcMap(slice: unknown): ReadonlyMap<string, FactionNpcRef> {
  const parsed = NpcSliceLiteSchema.parse(slice ?? {});
  return new Map(Object.entries(parsed.npcs));
}
