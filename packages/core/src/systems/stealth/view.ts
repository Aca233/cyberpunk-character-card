import type { ViewContext } from "../../kernel/system";
import { WorldClockStateSchema } from "../world";
import { currentAlert } from "./apply";
import { ALERT_LABELS, StealthStateSchema } from "./schema";

/** 玩家可见的当前位置警戒；既有界面读出不变。 */
export function stealthView({ world }: ViewContext) {
  const clock = WorldClockStateSchema.parse(world.slices.world);
  const state = StealthStateSchema.parse(world.slices.stealth);
  const alert = currentAlert(state, clock.location);
  return {
    level: alert.level,
    label: ALERT_LABELS[alert.level],
    peak: alert.peak,
  };
}
