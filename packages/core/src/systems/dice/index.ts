import { z } from "zod";
import { defineSystem, type RuleModule } from "../../kernel/system";
import { type DiceState, DiceStateSchema, type Difficulty, DifficultySchema } from "./schema";

/** 难度模式只在开局建档时由代码设置，模型不能改 */
export type DiceInternal = { readonly type: "dice.setMode"; readonly mode: Difficulty };

const streetLegendRules: RuleModule<DiceState> = {
  id: "streetLegend",
  title: "难度：街头传说",
  when: (s) => s.mode === "streetLegend",
  text: `- 当前难度是街头传说：致命失败时总有一条退路，角色不会死，代价落在欧元、人性或关系上。
- 濒死撑到期限还没人救时，代码会让角色被人拖出来（生命很低，战斗按败局结束）；你在正文里写出是谁救的、怎么救的、欠下了什么，再写对应的 trade（付医药费、打点写 service）、humanity 或 affinity。`,
};

const deathCityRules: RuleModule<DiceState> = {
  id: "deathCity",
  title: "难度：死亡之城",
  when: (s) => s.mode === "deathCity",
  text: "- 当前难度是死亡之城：死了就结束，不能重来。致命的危险一定先在正文里明确提示，并在检定的失败后果里写清楚会死；没提示过的失败不能致死。",
};

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
  rules: [streetLegendRules, deathCityRules],
});

export * from "./apply";
export * from "./facts";
export * from "./schema";
