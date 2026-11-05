import type { ViewContext } from "../../kernel/system";
import { CONDITION_LABELS, woundSlotOf, woundTag } from "./apply";
import { HealthStateSchema, LIMB_LABELS, WOUND_SLOT_LABELS } from "./schema";

/** 玩家可见的生命状态：3.0 提供四格具象伤势（0..4），兼容旧字段 */
export function healthView({ world }: ViewContext) {
  const health = HealthStateSchema.parse(world.slices.health);
  const wounds = woundSlotOf(health);
  return {
    hp: health.hp,
    max: health.max,
    wounds,
    woundLabel: WOUND_SLOT_LABELS[wounds],
    painSuppressed: health.painSuppressed ?? false,
    condition: health.condition,
    conditionLabel: CONDITION_LABELS[health.condition],
    wound: woundTag(health),
    /** 断了还没装义肢的部位 */
    lostLimbs: health.lostLimbs.map((l) => ({ id: l, label: LIMB_LABELS[l] })),
  };
}
