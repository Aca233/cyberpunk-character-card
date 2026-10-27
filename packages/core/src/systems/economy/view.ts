import type { ViewContext } from "../../kernel/system";
import { EconomyStateSchema } from "./schema";

/** 玩家可见的欧元：只有身上的钱；去重用的已结算事件不在这里 */
export function moneyView({ world }: ViewContext) {
  const economy = EconomyStateSchema.parse(world.slices.economy);
  return { eddies: economy.eddies };
}
