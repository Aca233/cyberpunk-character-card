import type { ViewContext } from "../../kernel/system";
import { WorldClockStateSchema } from "../world";
import { currentAlert } from "./apply";
import { ALERT_LABELS, StealthStateSchema } from "./schema";

/** 玩家可见的当前场景潜入警戒；换场景后的取值仍由 currentAlert 决定 */
export function stealthView({ world }: ViewContext) {
  const clock = WorldClockStateSchema.parse(world.slices.world);
  const state = StealthStateSchema.parse(world.slices.stealth ?? {});
  const alert = currentAlert(state, clock.scene);
  return {
    level: alert.level,
    label: ALERT_LABELS[alert.level],
    peak: alert.peak,
    lowered: alert.lowered,
  };
}
