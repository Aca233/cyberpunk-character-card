import { z } from "zod";
import { defineAction } from "../../kernel/system";

/** 超梦体验编辑器：标出一个线索点，看它的扫描结果；下结论走回合（input.braindance） */
export const BraindanceActionSchema = z.strictObject({
  type: z.literal("braindance"),
  action: z.literal("mark"),
  point: z.string().regex(/^[a-z0-9-]{1,40}$/),
});

/** 超梦编辑器的操作：只翻成指令，统一由操作入口结算 */
export const braindanceActions = {
  braindance: defineAction({
    schema: BraindanceActionSchema,
    commands: (action) => [{ type: "braindance.mark", point: action.point }],
  }),
};
