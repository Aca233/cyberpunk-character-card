import { z } from "zod";
import { defineAction } from "../../kernel/system";

/** 小队面板：accept、decline 回应入队请求，dismiss 请队员离开，pay 发雇佣型队员的薪水 */
export const SquadActionSchema = z.strictObject({
  type: z.literal("squad"),
  action: z.enum(["accept", "decline", "dismiss", "pay"]),
  npc: z.string().min(1).max(64),
});

/** 小队面板的操作：只翻成指令，统一由操作入口结算 */
export const squadActions = {
  squad: defineAction({
    schema: SquadActionSchema,
    commands: (action, { world }) => {
      const combat = (world.slices.combat as { active?: unknown } | undefined)?.active;
      if (combat && action.action !== "pay") return "打斗中顾不上，打完再说";
      return [{ type: "squad.member", action: action.action, npc: action.npc }];
    },
  }),
};
