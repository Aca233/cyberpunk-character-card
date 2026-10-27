import { z } from "zod";
import { defineAction } from "../../kernel/system";

/** 在委托板上接下一单挂着的委托 */
export const AcceptJobActionSchema = z.strictObject({
  type: z.literal("acceptJob"),
  id: z.string().min(1).max(64),
});

/** 在委托板上接单时写进进展笔记的一句 */
export const BOARD_ACCEPT_NOTE = "在委托板上接下，正文里还没和对方细谈";

/** 委托板的操作：只翻成指令，统一由操作入口结算 */
export const jobsActions = {
  acceptJob: defineAction({
    schema: AcceptJobActionSchema,
    // 记一条进展笔记，让叙事模型知道这单是在板上接的，正文里还没谈过
    commands: (action) => [
      { type: "jobAccept", id: action.id },
      { type: "jobNote", id: action.id, note: BOARD_ACCEPT_NOTE },
    ],
  }),
};
