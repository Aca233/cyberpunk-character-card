import { z } from "zod";
import { defineAction } from "../../kernel/system";
import { AttributeSchema } from "../dice";

/** 分配一个街头声望攒下的属性点 */
export const SpendPointActionSchema = z.strictObject({
  type: z.literal("spendPoint"),
  attribute: AttributeSchema,
});

/** 角色卡上的习惯：add 自己写一条，confirm 认下叙事模型的提议，dismiss 不要这条提议，remove 删掉 */
export const HabitActionSchema = z.strictObject({
  type: z.literal("habit"),
  action: z.enum(["add", "confirm", "dismiss", "remove"]),
  text: z.string().trim().min(1).max(40),
});

/** 角色面板的操作：只翻成指令，统一由操作入口结算 */
export const characterActions = {
  spendPoint: defineAction({
    schema: SpendPointActionSchema,
    commands: (action) => [{ type: "character.spendPoint", attribute: action.attribute }],
  }),
  habit: defineAction({
    schema: HabitActionSchema,
    commands: (action) => [{ type: "character.habit", action: action.action, text: action.text }],
  }),
};
