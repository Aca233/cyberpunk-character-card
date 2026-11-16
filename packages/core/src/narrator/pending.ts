import { effectiveTurns, type LogRecord, type TurnRecord } from "../kernel/turnlog";
import { TurnInputSchema } from "../schemas/turn";
import { type Choice, ChoiceProposalSchema } from "./block";

/** 最近一次世界行动留下的文字建议；建议不构成行动限制。 */
export interface Offers {
  readonly turn: TurnRecord | undefined;
  readonly choices: readonly Choice[];
}

function isOoc(turn: TurnRecord): boolean {
  if (turn.ooc === true) return true;
  const input = TurnInputSchema.safeParse(turn.input);
  return input.success && input.data.mode === "ooc";
}

export function readChoices(raw: readonly unknown[] | undefined): Choice[] {
  const out: Choice[] = [];
  for (const item of raw ?? []) {
    const parsed = ChoiceProposalSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export function currentOffers(records: readonly LogRecord[]): Offers {
  const turn = effectiveTurns(records).findLast((t) => !isOoc(t));
  return { turn, choices: readChoices(turn?.choices) };
}
