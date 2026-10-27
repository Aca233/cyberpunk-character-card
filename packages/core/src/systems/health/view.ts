import type { ViewContext } from "../../kernel/system";
import { CONDITION_LABELS, woundTag } from "./apply";
import { HealthStateSchema, LIMB_LABELS } from "./schema";

/** 玩家可见的生命状态；失血计时、伤害来源和打坏的义体不在这里（义体在 cyberware 里标） */
export function healthView({ world }: ViewContext) {
  const health = HealthStateSchema.parse(world.slices.health);
  return {
    hp: health.hp,
    max: health.max,
    condition: health.condition,
    conditionLabel: CONDITION_LABELS[health.condition],
    wound: woundTag(health),
    /** 断了还没装义肢的部位 */
    lostLimbs: health.lostLimbs.map((l) => ({ id: l, label: LIMB_LABELS[l] })),
  };
}
