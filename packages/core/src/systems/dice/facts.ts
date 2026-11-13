import { z } from "zod";
import type { CheckBand, CheckOutcome, CheckResult, PreparedCheck } from "./apply";
import { AttributeSchema, CheckSpecSchema, DamageTierSchema } from "./schema";

export const CheckBandSchema: z.ZodType<CheckBand> = z.enum(["clean", "costly", "fail"]);

export const CheckOutcomeSchema: z.ZodType<CheckOutcome> = z.enum([
  "critical",
  "success",
  "costly",
  "failure",
  "fumble",
]);

/** 本轮检定结果，由回合流程放进 ctx.facts.check，伤害与态势系统据此校验 */
export const CheckFactSchema = z.object({
  /** 检定 id，同一次检定只能扣一次血 */
  id: z.string().min(1),
  outcome: CheckOutcomeSchema,
  /** 3.0 三段式结果档位：clean / costly / fail */
  band: CheckBandSchema.optional(),
  /** 差值 Δ = total - dv */
  delta: z.number().int().optional(),
  /** 后台推进增量与风险增量 */
  progressDelta: z.number().int().optional(),
  riskDelta: z.number().int().optional(),
  tacticalTags: z.array(z.string()).optional(),
  /** 检定使用的属性与对手，供抵抗快速破解时核对；旧事实可缺省 */
  attribute: AttributeSchema.optional(),
  opponent: z.string().min(1).optional(),
  /** 掷骰前绑定的快速破解来源，与检定 id 一起标识本次攻击 */
  npcHack: CheckSpecSchema.shape.npcHack,
  /** check 里事先说明的伤害档位 */
  damage: DamageTierSchema.optional(),
  /** check 里事先写明了断肢风险 */
  limb: z.boolean().optional(),
  /** check 里事先写的“失败会怎样”；队员会不会死按这句里有没有点名来判 */
  failure: z.string().optional(),
});
export type CheckFact = z.infer<typeof CheckFactSchema>;

export function checkFactFrom(id: string, check: PreparedCheck, result: CheckResult): CheckFact {
  return {
    id,
    outcome: result.outcome,
    band: result.band,
    delta: result.delta,
    progressDelta: result.progressDelta,
    riskDelta: result.riskDelta,
    ...(result.tacticalTags ? { tacticalTags: [...result.tacticalTags] } : {}),
    attribute: check.spec.attribute,
    ...(check.spec.opponent === undefined ? {} : { opponent: check.spec.opponent }),
    ...(check.spec.npcHack === undefined ? {} : { npcHack: { ...check.spec.npcHack } }),
    ...(check.spec.damage === undefined ? {} : { damage: check.spec.damage }),
    ...(check.spec.limb === true ? { limb: true } : {}),
    failure: check.spec.failure,
  };
}

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

/** 读取本轮检定结果；没有检定时返回 undefined，格式不对时报错 */
export function checkFact(facts: Readonly<Record<string, unknown>>): CheckFact | undefined {
  if (facts.check === undefined) return undefined;
  const parsed = CheckFactSchema.safeParse(facts.check);
  if (!parsed.success) throw new Error(`本轮的检定结果格式不对：${parsed.error.message}`);
  return parsed.data;
}

/**
 * 队员之死的保底：
 * - 零掷骰模式下要求本轮面临明确致命危机（ruling.harm === "lethal"）；
 * - 兼容旧掷骰回放时的失败检定点名规则
 */
export function memberDeathBlocked(
  facts: Readonly<Record<string, unknown>>,
  names: readonly string[],
): string | undefined {
  const check = checkFact(facts);
  const who = names[0] ?? "队员";
  if (check) {
    const why = `${who}是队员：只有检定事先在失败后果里点名写明${who}有致命危险、检定又失败时才会死；没有这样警告过的，最坏写 squad status hurt 或 captured`;
    if (check.outcome !== "failure" && check.outcome !== "fumble") return why;
    const text = check.failure ?? "";
    return names.some((n) => n.trim() !== "" && text.includes(n.trim())) ? undefined : why;
  }
  const ruling = rulingFact(facts);
  if (ruling?.harm === "lethal") return undefined;
  return `${who}是队员：只有在致命危机（harm=lethal）且战场上真出事时才会死；平常受创最坏写 squad status hurt 或 captured`;
}

/** 内部兼容血量换算基准（前台已改为 0..4 四格具象伤势） */
export function maxHp(body: number, streetCred: number): number {
  return 150 + body * 20 + streetCred * 5;
}
