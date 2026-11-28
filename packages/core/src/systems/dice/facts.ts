import { z } from "zod";
import { DamageTierSchema } from "./schema";

/** 本轮定性物理与社会裁决，由回合流程放进 ctx.facts.ruling，伤害、骇入与态势系统据此校验（零掷骰模式） */
export const RulingFactSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["possible", "costly", "blocked"]).default("costly"),
  harm: DamageTierSchema.or(z.literal("none")).default("none"),
  condition: z.enum(["down", "dying", "dead"]).optional(),
  npcDeaths: z.array(z.string().min(1)).optional(),
  limb: z.boolean().optional(),
  reason: z.string().optional(),
});
export type RulingFact = z.infer<typeof RulingFactSchema>;

export function rulingFactFrom(
  id: string,
  ruling?: {
    readonly kind: "possible" | "costly" | "blocked";
    readonly harm: "none" | "graze" | "heavy" | "lethal";
    readonly condition?: "down" | "dying" | "dead" | undefined;
    readonly npcDeaths?: readonly string[] | undefined;
    readonly limb?: boolean | undefined;
    readonly reason?: string | undefined;
  },
): RulingFact {
  return {
    id,
    kind: ruling?.kind ?? "costly",
    harm: ruling?.harm ?? "none",
    ...(ruling?.condition ? { condition: ruling.condition } : {}),
    ...(ruling?.npcDeaths?.length ? { npcDeaths: [...ruling.npcDeaths] } : {}),
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

/** 读取本轮敌方黑客反制的独立裁决；未单独给出时返回 undefined，绝不复用主行动 ruling */
export function npcHackRulingFact(
  facts: Readonly<Record<string, unknown>>,
): RulingFact | undefined {
  const raw = facts.npcHackRuling;
  if (raw === undefined) return undefined;
  const parsed = RulingFactSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** 同行者死亡必须有已确认的致命危机，旧检定字段不能替代现实依据。 */
export function memberDeathBlocked(
  facts: Readonly<Record<string, unknown>>,
  ids: readonly string[],
  names: readonly string[],
): string | undefined {
  const who = names[0] ?? "同行者";
  const ruling = rulingFact(facts);
  if (ids.some((id) => ruling?.npcDeaths?.includes(id))) return undefined;
  return `${who}正与你同行：需要在独立人物裁决 npcDeaths 中明确确认其死亡；主角的 harm 不能代替同伴的实际后果，普通受创写 npcHurt`;
}
