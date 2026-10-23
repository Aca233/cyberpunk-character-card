import {
  type CheckRecord,
  effectiveTurns,
  type LogRecord,
  type TurnRecord,
} from "../kernel/turnlog";
import type { WorldState } from "../kernel/world";
import { TurnInputSchema } from "../schemas/turn";
import { CharacterStateSchema } from "../systems/character/schema";
import {
  type CheckResult,
  type CheckSpec,
  CheckSpecSchema,
  DiceStateSchema,
  type PreparedCheck,
  type PrepareResult,
  prepareCheck,
  resolveCheck,
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

/** 掷过骰的检定，交给主持人写结果 */
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
  let rolled: Offers["rolled"];
  for (const record of records.slice(turn.seq + 1)) {
    if (record.kind !== "check") continue;
    const offer = checks.find((c) => c.id === record.checkId);
    if (offer) {
      rolled = { offer, record };
      break;
    }
  }
  return { turn, choices: readChoices(turn.choices), checks, rolled };
}

/** 按角色当前的属性和难度模式算出难度值和成功率 */
export function prepareFor(world: WorldState, spec: CheckSpec): PrepareResult {
  const character = CharacterStateSchema.parse(world.slices.character);
  const dice = DiceStateSchema.parse(world.slices.dice);
  return prepareCheck(spec, character.attributes[spec.attribute], dice.mode);
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
