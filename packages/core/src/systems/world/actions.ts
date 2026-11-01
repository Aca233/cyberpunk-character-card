import { z } from "zod";
import { defineAction } from "../../kernel/system";

/**
 * 地图上拖地点（places-plan 第二期，用户定的 2026-10-30）：剧情里记下的地点（place:）坐标是代码估的，
 * 玩家可以拖到准确的位置再保存；不调用模型，id、城区和能不能拖由 world.movePlace 结算时检查
 */
export const MovePlaceActionSchema = z.strictObject({
  type: z.literal("movePlace"),
  id: z.string().min(1).max(64),
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
});

export const worldActions = {
  movePlace: defineAction({
    schema: MovePlaceActionSchema,
    commands: (action) => [{ type: "world.movePlace", id: action.id, x: action.x, y: action.y }],
  }),
};
