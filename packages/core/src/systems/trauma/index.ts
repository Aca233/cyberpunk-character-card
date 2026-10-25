import { defineSystem } from "../../kernel/system";
import { applyTrauma, tickTrauma } from "./apply";
import { traumaRules } from "./prompt";
import {
  type TraumaCommand,
  TraumaCommandSchema,
  type TraumaState,
  TraumaStateSchema,
} from "./schema";

/** 创伤小组会籍：买一期管 30 天，倒下或濒死时按档位、地点、交火和热度判断来不来 */
export const trauma = defineSystem<TraumaState, TraumaCommand>({
  id: "trauma",
  dependsOn: ["world", "economy", "health", "combat", "heat"],
  state: TraumaStateSchema,
  initial: () => ({ tier: "none", paidUntil: null, lapsedAt: null, rescues: 0 }),
  commands: { trauma: TraumaCommandSchema },
  apply: (draft, command, ctx) => applyTrauma(draft, command, ctx),
  tick: (draft, span) => tickTrauma(draft, span),
  rules: [traumaRules],
});

export * from "./apply";
export * from "./prompt";
export * from "./schema";
