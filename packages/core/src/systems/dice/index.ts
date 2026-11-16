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
- 跌入生死线濒死没人救时，代码会让角色被熟人或副心脏拖回黑诊所（欠下救命血债）；你在正文里写出是谁救的、怎么救的、欠下了什么。`,
};

const deathCityRules: RuleModule<DiceState> = {
  id: "deathCity",
  title: "难度：死亡之城",
  when: (s) => s.mode === "deathCity",
  text: "- 当前难度是死亡之城：跌入生死线濒死且无白金创伤卡、无副心脏、无在场盟友时角色正式谢幕，生平载入来生传奇名册。致命的危险一定先在正文里明确提示。",
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
  view: {
    key: "difficulty",
    project: ({ world }) => DiceStateSchema.parse(world.slices.dice).mode,
  },
});

export * from "./apply";
export * from "./facts";
export * from "./schema";
