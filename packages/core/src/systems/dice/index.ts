import { z } from "zod";
import { defineSystem } from "../../kernel/system";
import { type DiceState, DiceStateSchema, type Difficulty, DifficultySchema } from "./schema";

/** 难度模式只在开局建档时由代码设置，模型不能改 */
export type DiceInternal = { readonly type: "dice.setMode"; readonly mode: Difficulty };

export const dice = defineSystem<DiceState, never, DiceInternal>({
  id: "dice",
  state: DiceStateSchema,
  initial: () => ({ mode: "nightCity" }),
  commands: {},
  internal: {
    "dice.setMode": z.object({ type: z.literal("dice.setMode"), mode: DifficultySchema }),
  },
  apply(draft, command) {
    draft.mode = command.mode;
    return { ok: true };
  },
});

export * from "./apply";
export * from "./schema";
