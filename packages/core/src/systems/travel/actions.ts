import { z } from "zod";
import { defineAction } from "../../kernel/system";
import { CombatStateSchema } from "../combat";

/** 在车辆页选用停在玩家身边的车辆；位置和车况由 vehicle select 统一校验。 */
export const SelectVehicleActionSchema = z.strictObject({
  type: z.literal("selectVehicle"),
  id: z.string().min(1).max(128),
});

export const travelActions = {
  selectVehicle: defineAction({
    schema: SelectVehicleActionSchema,
    commands: (action, { world }) => {
      if (CombatStateSchema.parse(world.slices.combat).active !== null)
        return "战斗中换车需要结合当前处境，请在行动里描述";
      return [
        {
          type: "vehicle",
          action: "select",
          vehicle: action.id,
          reason: "通过车辆页选用",
        },
      ];
    },
  }),
};
