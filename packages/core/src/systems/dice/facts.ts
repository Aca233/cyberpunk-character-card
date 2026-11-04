import { z } from "zod";
import type { CheckOutcome, CheckResult, PreparedCheck } from "./apply";
import { AttributeSchema, CheckSpecSchema, DamageTierSchema } from "./schema";

export const CheckOutcomeSchema: z.ZodType<CheckOutcome> = z.enum([
  "critical",
  "success",
  "failure",
  "fumble",
]);

/** 本轮检定结果，由回合流程放进 ctx.facts.check，伤害等系统据此校验 */
export const CheckFactSchema = z.object({
  /** 检定 id，同一次检定只能扣一次血 */
  id: z.string().min(1),
  outcome: CheckOutcomeSchema,
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
    attribute: check.spec.attribute,
    ...(check.spec.opponent === undefined ? {} : { opponent: check.spec.opponent }),
    ...(check.spec.npcHack === undefined ? {} : { npcHack: { ...check.spec.npcHack } }),
    ...(check.spec.damage === undefined ? {} : { damage: check.spec.damage }),
    ...(check.spec.limb === true ? { limb: true } : {}),
    failure: check.spec.failure,
  };
}

/** 读取本轮检定结果；没有检定时返回 undefined，格式不对时报错 */
export function checkFact(facts: Readonly<Record<string, unknown>>): CheckFact | undefined {
  if (facts.check === undefined) return undefined;
  const parsed = CheckFactSchema.safeParse(facts.check);
  if (!parsed.success) throw new Error(`本轮的检定结果格式不对：${parsed.error.message}`);
  return parsed.data;
}

/**
 * 队员之死的保底：这一轮有检定、检定失败（或大失败），且检定事先写的失败后果里点了这名队员的名字，
 * 才允许写死；否则返回拒绝的原因（最坏是重伤或被抓）
 */
export function memberDeathBlocked(
  facts: Readonly<Record<string, unknown>>,
  names: readonly string[],
): string | undefined {
  const check = checkFact(facts);
  const who = names[0] ?? "队员";
  const why = `${who}是队员：只有检定事先在失败后果里点名写明${who}有致命危险、检定又失败时才会死；没有这样警告过的，最坏写 squad status hurt 或 captured`;
  if (!check || (check.outcome !== "failure" && check.outcome !== "fumble")) return why;
  const text = check.failure ?? "";
  return names.some((n) => n.trim() !== "" && text.includes(n.trim())) ? undefined : why;
}

/** 生命上限（暂定，试玩时调平衡）：随肉体和街头声望等级增长 */
export function maxHp(body: number, streetCred: number): number {
  return 150 + body * 20 + streetCred * 5;
}
