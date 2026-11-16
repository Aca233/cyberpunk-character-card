import { z } from "zod";
import { defineAction } from "../../kernel/system";
import { HealthStateSchema } from "../health";
import { InventoryStateSchema } from "../inventory";
import { formatGameTime } from "../world";
import { suppressantStatus } from "./apply";
import { PsychosisStateSchema, SUPPRESSANT_ID } from "./schema";

/** 非战斗时在背包直接使用神经压制剂 */
export const UseSuppressantActionSchema = z.strictObject({
  type: z.literal("useSuppressant"),
});

/** 赛博精神病相关的界面快捷操作：非战斗时主动注射压制剂 */
export const psychosisActions = {
  useSuppressant: defineAction({
    schema: UseSuppressantActionSchema,
    commands: (_action, { world }) => {
      if ((world.slices.combat as { active?: unknown } | undefined)?.active) {
        return "战斗中注射压制剂要花一个动作，在行动里写";
      }
      const health = HealthStateSchema.parse(world.slices.health);
      if (health.condition !== "up") return "当前无法自行注射，需要别人救治";
      const inventory = InventoryStateSchema.parse(world.slices.inventory);
      if ((inventory.backpack[SUPPRESSANT_ID] ?? 0) < 1) return "背包里没有神经压制剂";
      const psychosis = PsychosisStateSchema.parse(world.slices.psychosis);
      const status = suppressantStatus(psychosis.doses, world.time);
      if (status.until !== null) {
        return `压制剂仍在起效中（到 ${formatGameTime(status.until)}），不用重复注射`;
      }
      return [{ type: "suppressant", reason: "主动注射神经压制剂" }];
    },
  }),
};
