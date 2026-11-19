import { z } from "zod";
import { defineAction } from "../../kernel/system";
import { TraumaCommandSchema } from "./schema";

/** 创伤小组会员中心的即时操作；统一复用内核资格、报价与原子扣款。 */
export const TraumaActionSchema = z
  .strictObject({
    type: z.literal("trauma"),
    action: z.enum(["join", "renew", "upgrade", "cancel", "rescue"]),
    tier: z.enum(["silver", "platinum"]).optional(),
  })
  .refine((action) => action.action !== "join" || action.tier !== undefined, {
    message: "初次办理要选择 silver 或 platinum",
    path: ["tier"],
  });

export const traumaActions = {
  trauma: defineAction({
    schema: TraumaActionSchema,
    commands: (action) => [
      TraumaCommandSchema.parse({
        ...action,
        reason:
          action.action === "rescue" ? "通过生物监测呼叫创伤小组" : "通过创伤小组会员中心办理",
      }),
    ],
  }),
};
