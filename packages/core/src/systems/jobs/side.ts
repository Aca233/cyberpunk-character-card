import { z } from "zod";
import type { FixerCard } from "./apply";

/**
 * 势力的入口经 phone 又引回 jobs，这里不引用势力系统；
 * 和 inventory/mood.ts 一样，只读派单要用的几项：势力表的 id、名字、初始态度，和记下的态度
 */
const FactionRowsSchema = z
  .array(z.object({ id: z.string(), name: z.string(), initial: z.string().default("neutral") }))
  .catch([]);
const StancesSchema = z
  .object({
    stances: z.record(z.string(), z.object({ attitude: z.string() })).default({}),
    membership: z.object({ faction: z.string() }).nullable().default(null),
  })
  .catch({ stances: {}, membership: null });

/** 派单人所属势力现在对玩家的态度（用户 2026-10-31 选的「势力进机制」）；不属于势力表里的势力时是 undefined */
export function factionSide(
  faction: string | undefined,
  data: Readonly<Record<string, unknown>>,
  slice: unknown,
): FixerCard["faction"] {
  if (faction === undefined) return undefined;
  const def = FactionRowsSchema.parse(data.factions).find((f) => f.id === faction);
  if (!def) return undefined;
  const state = StancesSchema.parse(slice ?? {});
  const attitude = state.stances[def.id]?.attitude ?? def.initial;
  const member = state.membership?.faction === def.id;
  return { name: def.name, attitude, ...(member ? { member: true } : {}) };
}
