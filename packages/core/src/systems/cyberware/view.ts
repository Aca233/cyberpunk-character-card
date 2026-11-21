import type { ViewContext } from "../../kernel/system";
import { RARITY_LABELS } from "../economy";
import { HealthStateSchema } from "../health";
import { cyberwareCatalog } from "./apply";
import {
  BEHAVIOR_CHIP_MODE_LABELS,
  type BehaviorChipMode,
  type CyberwareDef,
  CyberwareStateSchema,
  DECK_TRAIT_LABELS,
  SLOT_LABELS,
} from "./schema";

export function cyberwarePartsView({ world, data }: ViewContext) {
  const state = CyberwareStateSchema.parse(world.slices.cyberware ?? {});
  const catalog = cyberwareCatalog(data);
  return Object.values(state.parts)
    .filter((part) => part.holder === "player")
    .map((part) => ({
      id: part.id,
      model: part.model,
      name: catalog.get(part.model)?.name ?? part.model,
      condition: part.condition,
      source: part.source,
      location: part.location,
      rarity: catalog.get(part.model)?.rarity ?? null,
      ability: catalog.get(part.model)?.ability ?? null,
    }));
}

/** 义体的特殊机制效果，例如护甲或斯安威斯坦动作格；没有时是空字符串 */
export function bonusText(def: CyberwareDef): string {
  return [
    ...(def.armor ? ["保护范围与承受能力按现场伤害判断"] : []),
    ...(def.accelerator ? ["加速行动，受设备与现实空间条件约束"] : []),
  ].join("、");
}

/** 装着的义体，按装上的先后；打坏的标出来 */
export function cyberwareView({ world, data }: ViewContext) {
  const { installed, behaviorChips } = CyberwareStateSchema.parse(world.slices.cyberware ?? {});
  const health = HealthStateSchema.parse(world.slices.health);
  const parts = cyberwareCatalog(data);
  return installed.map((c) => {
    const def = parts.get(c.id);
    const chipState = def?.behaviorChip ? behaviorChips?.[c.id] : undefined;
    const chipMode: BehaviorChipMode | null = def?.behaviorChip ? (chipState?.mode ?? "off") : null;
    return {
      id: c.id,
      name: def?.name ?? c.id,
      slot: c.slot,
      slotLabel: SLOT_LABELS[c.slot],
      rarityLabel: def ? RARITY_LABELS[def.rarity] : null,
      // 稀有度和标志性给义体页格子左边竖条染色（用户 2026-10-31："怎么没有稀有度颜色区分"）
      rarity: def?.rarity ?? null,
      iconic: def?.iconic ?? false,
      ability: def?.ability ?? null,
      bonusText: def ? bonusText(def) : "",
      armor: def?.armor ?? false,
      accelerator: def?.accelerator ?? false,
      deckProfile: def?.deckProfile,
      deckTraits: def?.deckTraits?.map((t) => DECK_TRAIT_LABELS[t]),
      behaviorChip:
        chipMode !== null
          ? {
              mode: chipMode,
              label: BEHAVIOR_CHIP_MODE_LABELS[chipMode],
              protocol: chipState?.protocol ?? null,
              memoryGap: chipState?.memoryGap ?? false,
            }
          : null,
      /** 被打坏了：修好前失去能力 */
      broken: health.brokenChrome.includes(c.id),
    };
  });
}
