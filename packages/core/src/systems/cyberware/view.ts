import type { ViewContext } from "../../kernel/system";
import { ATTRIBUTE_LABELS, type Attribute } from "../dice";
import { RARITY_LABELS } from "../economy";
import { HealthStateSchema } from "../health";
import { cyberwareCatalog } from "./apply";
import { BOOST_SLOTS, type CyberwareDef, CyberwareStateSchema, SLOT_LABELS } from "./schema";

/** 义体的属性加成，例如“反应 +2”；没有时是空字符串 */
export function bonusText(def: CyberwareDef): string {
  return [
    ...Object.entries(def.attributes).map(([a, n]) => `${ATTRIBUTE_LABELS[a as Attribute]} +${n}`),
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
      ability: def?.ability ?? null,
      bonusText: def ? bonusText(def) : "",
      /** 被打坏了：修好前失去能力 */
      broken: health.brokenChrome.includes(c.id),
    };
  });
}
