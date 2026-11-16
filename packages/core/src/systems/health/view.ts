import type { ViewContext } from "../../kernel/system";
import { CONDITION_LABELS, healthDisplay, woundSlotOf, woundTag } from "./apply";
import {
  BODY_PART_LABELS,
  HealthStateSchema,
  INJURY_TIER_LABELS,
  LIMB_LABELS,
  WOUND_SLOT_LABELS,
} from "./schema";

const MINUTES_PER_DAY = 1440;

/** 玩家可见的生理状态：含具体伤势档案、痛觉阻断与断肢情况，健康条仅为状态读出 */
export function healthView({ world }: ViewContext) {
  const health = HealthStateSchema.parse(world.slices.health);
  const wounds = woundSlotOf(health);
  return {
    ...healthDisplay(health),
    wounds,
    woundLabel: WOUND_SLOT_LABELS[wounds],
    painSuppressed: health.painSuppressed ?? false,
    condition: health.condition,
    conditionLabel: CONDITION_LABELS[health.condition],
    wound: woundTag(health),
    /** 具体非战斗伤势记录（战斗伤口由 combat.wounds 提供） */
    injuries: health.injuries.filter((inj) => inj.source !== "combat").map((inj) => ({
      ...inj,
      partLabel: inj.part ? BODY_PART_LABELS[inj.part] : null,
      tierLabel: INJURY_TIER_LABELS[inj.tier],
      daysLeft:
        inj.healsAt === null
          ? 0
          : Math.max(0, Math.ceil((inj.healsAt - world.time) / MINUTES_PER_DAY)),
    })),
    /** 断了还没装义肢的部位 */
    lostLimbs: health.lostLimbs.map((l) => ({ id: l, label: LIMB_LABELS[l] })),
  };
}
