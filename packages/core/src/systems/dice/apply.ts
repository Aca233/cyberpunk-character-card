import type { Rng } from "../../kernel/ports";
import type { DiceRoll } from "../../kernel/turnlog";
import { type CheckSpec, type Difficulty, type Modifier, OPPONENT_TIERS } from "./schema";

export const BONUS_CAP = 4;
export const PENALTY_CAP = 4;
export const DV_MOD_CAP = 4;
/** 街头传说的 −2 单独计算，不占修正上限；死亡之城的 +2 算进修正上限 */
const STREET_LEGEND_DV = -2;
const DEATH_CITY_DV = 2;
const MAX_ATTRIBUTE = 20;

export interface CappedTotal {
  readonly items: readonly Modifier[];
  /** 截断前的合计，HUD 明细里显示被截掉了多少 */
  readonly raw: number;
  readonly total: number;
}

export interface PreparedCheck {
  readonly spec: CheckSpec;
  readonly attributeValue: number;
  readonly bonus: CappedTotal;
  readonly penalty: CappedTotal;
  readonly dvMods: CappedTotal;
  /** 街头传说的难度值修正 */
  readonly modeDv: number;
  /** 最终难度值 */
  readonly dv: number;
  /** 检定值：属性 + 加成 − 减值 */
  readonly modifier: number;
  /** 骰面（含爆骰）至少要掷到多少才成功 */
  readonly need: number;
  /** 成功率，整数百分比；界面和示例都用这个值 */
  readonly chance: number;
}

export type PrepareResult =
  | { readonly ok: true; readonly check: PreparedCheck }
  | { readonly ok: false; readonly reason: string };

export type CheckOutcome = "critical" | "success" | "failure" | "fumble";

export interface CheckResult {
  readonly faces: readonly number[];
  /** 骰面合计（含爆骰） */
  readonly roll: number;
  readonly total: number;
  readonly dv: number;
  readonly outcome: CheckOutcome;
}

function capTotal(items: readonly Modifier[], limit: number): CappedTotal {
  const raw = items.reduce((sum, item) => sum + item.value, 0);
  return { items, raw, total: Math.min(raw, limit) };
}

/** 算出难度值、检定值和成功率；档位不对或属性越界时拒绝 */
export function prepareCheck(
  spec: CheckSpec,
  attributeValue: number,
  mode: Difficulty,
): PrepareResult {
  if (!Number.isInteger(attributeValue) || attributeValue < 1 || attributeValue > MAX_ATTRIBUTE) {
    return { ok: false, reason: `属性值必须是 1–${MAX_ATTRIBUTE} 的整数：${attributeValue}` };
  }
  const tier = OPPONENT_TIERS[spec.tier];
  const [min, max] = tier.dv;
  if (spec.dv < min || spec.dv > max) {
    return { ok: false, reason: `${tier.label}的难度值应在 ${min}–${max} 之间，给的是 ${spec.dv}` };
  }
  const dvItems: Modifier[] = [...spec.dvMods];
  if (mode === "deathCity") {
    dvItems.push({ source: "difficulty", value: DEATH_CITY_DV, reason: "死亡之城难度" });
  }
  const bonus = capTotal(spec.bonuses, BONUS_CAP);
  const penalty = capTotal(spec.penalties, PENALTY_CAP);
  const dvMods = capTotal(dvItems, DV_MOD_CAP);
  const modeDv = mode === "streetLegend" ? STREET_LEGEND_DV : 0;
  const dv = spec.dv + dvMods.total + modeDv;
  const modifier = attributeValue + bonus.total - penalty.total;
  const need = dv - modifier;
  return {
    ok: true,
    check: {
      spec,
      attributeValue,
      bonus,
      penalty,
      dvMods,
      modeDv,
      dv,
      modifier,
      need,
      chance: successChance(need),
    },
  };
}

/** 掷出 10 再掷一次累加，掷出 1 再掷一次扣除；追加的那一次不再爆骰 */
export function faceTotal(faces: readonly number[]): number {
  for (const face of faces) {
    if (!Number.isInteger(face) || face < 1 || face > 10) {
      throw new Error(`骰面必须是 1–10 的整数：${face}`);
    }
  }
  const [first, second] = faces;
  if (first === undefined) throw new Error("没有骰面");
  const explodes = first === 1 || first === 10;
  if (faces.length !== (explodes ? 2 : 1)) throw new Error(`骰面个数不对：${faces.join(", ")}`);
  if (!explodes || second === undefined) return first;
  return first === 10 ? 10 + second : 1 - second;
}

/** 骰面至少掷到 need 的概率（整数百分比）：枚举第一颗和追加的一颗，正好 100 种 */
export function successChance(need: number): number {
  let wins = 0;
  for (let first = 1; first <= 10; first += 1) {
    for (let second = 1; second <= 10; second += 1) {
      const faces = first === 1 || first === 10 ? [first, second] : [first];
      if (faceTotal(faces) >= need) wins += 1;
    }
  }
  return wins;
}

export function rollFaces(rng: Rng): number[] {
  const first = rng.roll(10);
  return first === 1 || first === 10 ? [first, rng.roll(10)] : [first];
}

function outcomeOf(success: boolean, first: number | undefined): CheckOutcome {
  if (success) return first === 10 ? "critical" : "success";
  return first === 1 ? "fumble" : "failure";
}

/** 按已有骰面结算；重新生成和重放都走这里，不重掷 */
export function resolveCheck(check: PreparedCheck, faces: readonly number[]): CheckResult {
  const roll = faceTotal(faces);
  const total = roll + check.modifier;
  const outcome = outcomeOf(total >= check.dv, faces[0]);
  return { faces: [...faces], roll, total, dv: check.dv, outcome };
}

export function rollCheck(check: PreparedCheck, rng: Rng): CheckResult {
  return resolveCheck(check, rollFaces(rng));
}

export function isSuccess(outcome: CheckOutcome): boolean {
  return outcome === "critical" || outcome === "success";
}

/** 写进回合日志的掷骰记录；调模型之前先落盘 */
export function diceRecord(check: PreparedCheck, result: CheckResult): DiceRoll {
  return { purpose: `check:${check.spec.attribute}`, sides: 10, faces: [...result.faces] };
}
