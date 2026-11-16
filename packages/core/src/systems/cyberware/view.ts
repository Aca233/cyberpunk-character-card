import type { ViewContext } from "../../kernel/system";
import { RARITY_LABELS } from "../economy";
import { HealthStateSchema } from "../health";
import { cyberwareCatalog } from "./apply";
import { BOOST_SLOTS, type CyberwareDef, CyberwareStateSchema, SLOT_LABELS } from "./schema";

/** 义体的特殊机制效果，例如护甲或斯安威斯坦动作格；没有时是空字符串 */
export function bonusText(def: CyberwareDef): string {
  return [
    ...(def.armor ? ["受伤降一档"] : []),
    ...(def.accelerator ? [`斯安威斯坦时刻 ${BOOST_SLOTS[def.rarity]} 个动作格`] : []),
  ].join("、");
}

/** 装着的义体，按装上的先后；打坏的标出来 */
export function cyberwareView({ world, data }: ViewContext) {
  const { installed } = CyberwareStateSchema.parse(world.slices.cyberware ?? {});
  const health = HealthStateSchema.parse(world.slices.health);
  const parts = cyberwareCatalog(data);
  return installed.map((c) => {
    const def = parts.get(c.id);
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
      humanityCost: def?.humanityCost ?? 0,
      attributes: def?.attributes ?? {},
      checks: def?.checks ?? [],
      armor: def?.armor ?? false,
      accelerator: def?.accelerator ?? false,
      programSlots: def?.programSlots,
      ram: def?.ram,
      /** 被打坏了：修好前失去能力 */
      broken: health.brokenChrome.includes(c.id),
    };
  });
}
