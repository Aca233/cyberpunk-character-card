import {
  type CheckRecord,
  effectiveTurns,
  type LogRecord,
  type TurnRecord,
  voidedSeqs,
} from "../kernel/turnlog";
import type { WorldState } from "../kernel/world";
import { TurnInputSchema } from "../schemas/turn";
import { CharacterStateSchema, effectiveAttribute } from "../systems/character/schema";
import {
  type CheckResult,
  type CheckSpec,
  CheckSpecSchema,
  DiceStateSchema,
  type PreparedCheck,
  type PrepareResult,
  prepareCheck,
  resolveCheck,
  withMatrix,
} from "../systems/dice";
import { type Choice, ChoiceSchema } from "./block";

/** 等玩家确认的检定：回合里的 check，或某个建议选项预先带的 check */
export interface CheckOffer {
  /** 第 seq 轮的 check 是 "seq"，第 seq 轮第 n 个选项的 check 是 "seq.n" */
  readonly id: string;
  /** 界面上显示的行动：选项的文字，或 check 的意图 */
  readonly label: string;
  readonly spec: CheckSpec;
}

/** 最近一轮（不算出戏）留给玩家的东西 */
export interface Offers {
  readonly turn: TurnRecord | undefined;
  readonly choices: readonly Choice[];
  readonly checks: readonly CheckOffer[];
  /** 已经掷过骰、还没写出结果的检定；这时只能确认它，不能改做别的 */
  readonly rolled: { readonly offer: CheckOffer; readonly record: CheckRecord } | undefined;
}

/** 掷过骰的检定，交给叙事模型写结果 */
export interface RolledCheck {
  readonly offer: CheckOffer;
  readonly prepared: PreparedCheck;
  readonly result: CheckResult;
}

function isOoc(turn: TurnRecord): boolean {
  if (turn.ooc === true) return true;
  const input = TurnInputSchema.safeParse(turn.input);
  return input.success && input.data.mode === "ooc";
}

export function readChoices(raw: readonly unknown[] | undefined): Choice[] {
  const out: Choice[] = [];
  for (const item of raw ?? []) {
    const parsed = ChoiceSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export function checkOffers(turn: TurnRecord): CheckOffer[] {
  const offers: CheckOffer[] = [];
  const main = CheckSpecSchema.safeParse(turn.check);
  if (turn.check !== undefined && main.success) {
    offers.push({ id: String(turn.seq), label: main.data.intent, spec: main.data });
  }
  readChoices(turn.choices).forEach((choice, i) => {
    if (choice.check) {
      offers.push({ id: `${turn.seq}.${i + 1}`, label: choice.text, spec: choice.check });
    }
  });
  return offers;
}

export function currentOffers(records: readonly LogRecord[]): Offers {
  const turn = effectiveTurns(records).findLast((t) => !isOoc(t));
  if (!turn) return { turn: undefined, choices: [], checks: [], rolled: undefined };
  const checks = checkOffers(turn);
  const voided = voidedSeqs(records);
  let rolled: Offers["rolled"];
  for (const record of records.slice(turn.seq + 1)) {
    if (record.kind !== "check" || voided.has(record.seq)) continue;
    const offer = checks.find((c) => c.id === record.checkId);
    if (offer) {
      // 掷骰时玩过矩阵小游戏的，修正照骰子记录里的算
      rolled = { offer: { ...offer, spec: withMatrix(offer.spec, record.matrix) }, record };
      break;
    }
  }
  return { turn, choices: readChoices(turn.choices), checks, rolled };
}

/** 按角色当前的属性、生理伤势/疲劳/成瘾状态和难度模式算出难度值和成功率 */
export function prepareFor(world: WorldState, spec: CheckSpec): PrepareResult {
  const character = CharacterStateSchema.parse(world.slices.character);
  const dice = DiceStateSchema.parse(world.slices.dice);
  const attrVal = effectiveAttribute(character, spec.attribute);
  const reflexesValue = spec.reflexesValue ?? effectiveAttribute(character, "reflexes");
  const intelligenceValue = spec.intelligenceValue ?? effectiveAttribute(character, "intelligence");

  const penalties = [...spec.penalties];
  const bonuses = [...spec.bonuses];

  const rawHealth = world.slices.health as
    | { hp?: number; max?: number; painSuppressed?: boolean; lostLimbs?: readonly string[] }
    | undefined;
  const rawClock = world.slices.world as
    | {
        phasesAwake?: number;
        blackLaceDoses?: readonly number[];
        blackLaceActiveUntil?: number | null;
      }
    | undefined;

  const blackLaceActive =
    rawClock?.blackLaceActiveUntil !== undefined &&
    rawClock.blackLaceActiveUntil !== null &&
    rawClock.blackLaceActiveUntil > world.time;

  if (rawHealth && typeof rawHealth.hp === "number" && typeof rawHealth.max === "number") {
    const slot =
      rawHealth.hp <= 0
        ? 4
        : (rawHealth.lostLimbs?.length ?? 0) > 0 || rawHealth.hp * 100 < rawHealth.max * 30
          ? 3
          : rawHealth.hp * 100 < rawHealth.max * 60
            ? 2
            : 0;
    if (!blackLaceActive && !penalties.some((p) => p.source === "wound" || p.source === "伤势")) {
      if (slot >= 3) {
        penalties.push({ source: "伤势", value: 4, reason: "失能重残（全检定 −4）" });
      } else if (
        slot === 2 &&
        !rawHealth.painSuppressed &&
        (spec.attribute === "body" || spec.attribute === "reflexes")
      ) {
        penalties.push({ source: "伤势", value: 2, reason: "贯通重创（肉体/反应 −2）" });
      }
    }
  }

  if (blackLaceActive && spec.attribute === "body") {
    bonuses.push({
      source: "黑蕾丝药效",
      value: 2,
      reason: "战斗兴奋剂麻痹痛觉并激发潜能（肉体 +2）",
      pool: "hardware",
    });
  }

  if ((rawClock?.phasesAwake ?? 0) >= 4 && !penalties.some((p) => p.source === "疲劳")) {
    penalties.push({ source: "疲劳", value: 1, reason: "连续熬夜未眠（全属性 −1）" });
  }

  const recentDoses = (rawClock?.blackLaceDoses ?? []).filter((t) => t >= world.time - 7 * 1440);
  if (recentDoses.length >= 3 && !blackLaceActive) {
    if (spec.attribute === "reflexes" && !penalties.some((p) => p.source === "戒断")) {
      penalties.push({ source: "戒断", value: 1, reason: "黑蕾丝停药戒断手抖（反应 −1）" });
    } else if (spec.attribute === "cool" && !penalties.some((p) => p.source === "戒断")) {
      penalties.push({ source: "戒断", value: 2, reason: "黑蕾丝停药戒断焦虑（镇定 −2）" });
    }
  }

  return prepareCheck(
    {
      ...spec,
      bonuses,
      penalties,
      reflexesValue,
      intelligenceValue,
    },
    attrVal,
    dice.mode,
  );
}

/** 用已经写进日志的骰面结算；重试和重新生成都走这里，不重掷 */
export function rolledFrom(
  world: WorldState,
  offer: CheckOffer,
  faces: readonly number[],
): RolledCheck {
  const prepared = prepareFor(world, offer.spec);
  if (!prepared.ok) throw new Error(`检定 ${offer.id} 已经不能结算：${prepared.reason}`);
  return { offer, prepared: prepared.check, result: resolveCheck(prepared.check, faces) };
}
