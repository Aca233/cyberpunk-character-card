import type { ViewContext } from "../../kernel/system";
import { RARITY_LABELS } from "../economy";
import { HealthStateSchema } from "../health";
import { cyberwareCatalog } from "./apply";
import {
  ARM_SIDE_LABELS,
  BEHAVIOR_CHIP_MODE_LABELS,
  type BehaviorChipMode,
  CYBERWARE_CATEGORY_LABELS,
  type CyberwareDef,
  CyberwareStateSchema,
  cyberwareCategoryOf,
  cyberwareExclusiveGroup,
  cyberwareExtensionZone,
  cyberwareSectionOf,
  DECK_TRAIT_LABELS,
  EXCLUSIVE_GROUP_LABELS,
  effectiveCyberwareLoad,
  resolveArmSides,
  SECTION_LABELS,
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
      art: catalog.get(part.model)?.art ?? null,
      customImage: catalog.get(part.model)?.customImage ?? null,
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
  const armSideMap = resolveArmSides(
    installed.map((c) => {
      const def = parts.get(c.id);
      return {
        ...(def ?? { id: c.id, name: c.id, slot: c.slot }),
        ...(c.armSide ? { armSide: c.armSide } : {}),
      };
    }),
  );
  return installed.map((c) => {
    const def = parts.get(c.id);
    const chipState = def?.behaviorChip ? behaviorChips?.[c.id] : undefined;
    const chipMode: BehaviorChipMode | null = def?.behaviorChip ? (chipState?.mode ?? "off") : null;
    const probe = def ?? { id: c.id, name: c.id, slot: c.slot };
    const section = cyberwareSectionOf(probe);
    const category = cyberwareCategoryOf(probe);
    const extensionZone = cyberwareExtensionZone(probe);
    const armSide = armSideMap.get(c.id) ?? null;
    const effectiveLoad = effectiveCyberwareLoad(
      {
        id: c.id,
        slot: c.slot,
        humanityCost: def?.humanityCost ?? 0,
        ...(def?.exclusiveGroup ? { exclusiveGroup: def.exclusiveGroup } : {}),
        ...(def?.category ? { category: def.category } : {}),
        ...(def?.defaultArmSide ? { defaultArmSide: def.defaultArmSide } : {}),
        ...(armSide ? { armSide } : {}),
      },
      armSide ?? undefined,
    );
    return {
      id: c.id,
      name: def?.name ?? c.id,
      slot: c.slot,
      slotLabel: SLOT_LABELS[c.slot],
      section,
      sectionLabel: SECTION_LABELS[section],
      category,
      categoryLabel: CYBERWARE_CATEGORY_LABELS[category],
      extensionZone,
      armSide,
      armSideLabel: armSide ? ARM_SIDE_LABELS[armSide] : null,
      defaultArmSide: def?.defaultArmSide,
      effectiveLoad,
      rarityLabel: def ? RARITY_LABELS[def.rarity] : null,
      // 稀有度和标志性给义体页格子左边竖条染色（用户 2026-10-31："怎么没有稀有度颜色区分"）
      rarity: def?.rarity ?? null,
      iconic: def?.iconic ?? false,
      humanityCost: def?.humanityCost ?? 0,
      capacityBonus: def?.capacityBonus,
      safeLineBonus: def?.safeLineBonus,
      chassisProfile: def?.chassisProfile,
      smartLink: def?.smartLink ?? false,
      carryBonus: def?.carryBonus,
      defenses: def?.defenses,
      exclusiveGroup: def ? cyberwareExclusiveGroup(def) : null,
      exclusiveGroupLabel: def
        ? (() => {
            const g = cyberwareExclusiveGroup(def);
            return g ? EXCLUSIVE_GROUP_LABELS[g] : null;
          })()
        : null,
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
      art: def?.art ?? null,
      customImage: def?.customImage ?? null,
    };
  });
}
