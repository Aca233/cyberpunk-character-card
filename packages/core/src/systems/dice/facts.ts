import { z } from "zod";
import type { CheckOutcome, CheckResult, PreparedCheck } from "./apply";
import { DamageTierSchema } from "./schema";

export const CheckOutcomeSchema: z.ZodType<CheckOutcome> = z.enum([
  "critical",
  "success",
  "failure",
  "fumble",
]);

/** 本轮检定结果，由主持流程放进 ctx.facts.check，伤害等系统据此校验 */
export const CheckFactSchema = z.object({
  /** 检定 id，同一次检定只能扣一次血 */
  id: z.string().min(1),
  outcome: CheckOutcomeSchema,
  /** check 里事先说明的伤害档位 */
  damage: DamageTierSchema.optional(),
});
export type CheckFact = z.infer<typeof CheckFactSchema>;

export function checkFactFrom(id: string, check: PreparedCheck, result: CheckResult): CheckFact {
  return check.spec.damage === undefined
    ? { id, outcome: result.outcome }
    : { id, outcome: result.outcome, damage: check.spec.damage };
}

/** 读取本轮检定结果；没有检定时返回 undefined，格式不对时报错 */
export function checkFact(facts: Readonly<Record<string, unknown>>): CheckFact | undefined {
  if (facts.check === undefined) return undefined;
  const parsed = CheckFactSchema.safeParse(facts.check);
  if (!parsed.success) throw new Error(`本轮的检定结果格式不对：${parsed.error.message}`);
  return parsed.data;
}

/** 生命上限（暂定，试玩时调平衡）：随肉体和街头声望等级增长 */
export function maxHp(body: number, streetCred: number): number {
  return 150 + body * 20 + streetCred * 5;
}
