import { z } from "zod";
import { defineAction } from "../../kernel/system";
import { EPITAPH_CHARS, StoryEndSchema } from "./schema";

/** 履历页：玩家给这个角色的故事收尾（退休或停在这里），之后存档只读，角色进传说名册 */
export const EndStoryActionSchema = z.strictObject({
  type: z.literal("endStory"),
  how: StoryEndSchema,
  epitaph: z.string().trim().min(1).max(EPITAPH_CHARS).optional(),
});

/** 履历页的操作：只翻成指令，统一由操作入口结算 */
export const chronicleActions = {
  endStory: defineAction({
    schema: EndStoryActionSchema,
    commands: (action, { world }) => {
      const combat = (world.slices.combat as { active?: unknown } | undefined)?.active;
      if (combat) return "还在打，先活过这一场再说收尾";
      return [{ type: "chronicle.end", how: action.how, epitaph: action.epitaph ?? null }];
    },
  }),
};
