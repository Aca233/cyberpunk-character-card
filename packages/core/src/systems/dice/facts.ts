import { z } from "zod";
import { DamageTierSchema } from "./schema";

/** 本轮定性物理与社会裁决，由回合流程放进 ctx.facts.ruling，伤害、骇入与态势系统据此校验（零掷骰模式） */
export const RulingFactSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["possible", "costly", "blocked"]).default("costly"),
  harm: DamageTierSchema.or(z.literal("none")).default("none"),
  limb: z.boolean().optional(),
  reason: z.string().optional(),
});
export type RulingFact = z.infer<typeof RulingFactSchema>;

export function rulingFactFrom(
  id: string,
  ruling?: {
    readonly kind: "possible" | "costly" | "blocked";
    readonly harm: "none" | "graze" | "heavy" | "lethal";
    readonly limb?: boolean | undefined;
    readonly reason?: string | undefined;
  },
): RulingFact {
  return {
    id,
    kind: ruling?.kind ?? "costly",
    harm: ruling?.harm ?? "none",
    ...(ruling?.limb === true ? { limb: true } : {}),
    ...(ruling?.reason ? { reason: ruling.reason } : {}),
  };
}

/** 读取本轮定性裁决；没有时返回 undefined */
export function rulingFact(facts: Readonly<Record<string, unknown>>): RulingFact | undefined {
  if (facts.ruling === undefined) return undefined;
  const parsed = RulingFactSchema.safeParse(facts.ruling);
  return parsed.success ? parsed.data : undefined;
}

/** 读取本轮敌方黑客反制的独立裁决；未单独给出时回退到 ruling */
export function npcHackRulingFact(
  facts: Readonly<Record<string, unknown>>,
): RulingFact | undefined {
  const raw = facts.npcHackRuling ?? facts.ruling;
  if (raw === undefined) return undefined;
  const parsed = RulingFactSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** 队员死亡必须有已确认的致命危机，旧检定字段不能替代现实依据。 */
export function memberDeathBlocked(
  facts: Readonly<Record<string, unknown>>,
  names: readonly string[],
): string | undefined {
  const who = names[0] ?? "队员";
  const ruling = rulingFact(facts);
  if (ruling?.harm === "lethal") return undefined;
  return `${who}是队员：只有在致命危机（harm=lethal）且战场上真出事时才会死；平常受创最坏写 squad status hurt 或 captured`;
}
