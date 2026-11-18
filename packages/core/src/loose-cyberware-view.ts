import type { cyberwarePartsView } from "./systems/cyberware/view";
import { RARITY_LABELS } from "./systems/economy/schema";
import type { namesView } from "./systems/inventory/names";
import type { inventoryView } from "./systems/inventory/view";

/** 未安装实物沿用现有背包和详情字段，每件保留独立身份；安装仍需到医生处。 */
export function looseCyberwareView(
  inventory: ReturnType<typeof inventoryView>,
  names: ReturnType<typeof namesView>,
  parts: ReturnType<typeof cyberwarePartsView>,
) {
  const backpack = { ...inventory.backpack };
  const details = { ...inventory.details };
  const itemNames = { ...names.items };
  for (const part of parts) {
    if (part.location !== null || part.condition === "scrapped") continue;
    backpack[part.id] = 1;
    itemNames[part.id] = `${part.name}（未安装${part.condition === "damaged" ? "·损坏" : ""}）`;
    details[part.id] = {
      baseId: part.id,
      kind: "misc",
      subLabel: "义体实物",
      rarity: part.rarity,
      rarityLabel: part.rarity ? RARITY_LABELS[part.rarity] : null,
      iconic: false,
      bulky: false,
      concealment: null,
      noise: null,
      grantsSmartLink: false,
      modSlots: [],
      weaponState: null,
      ability: [part.ability, `来源：${part.source}`, "可携带、存放或交给医生检查安装。"]
        .filter(Boolean)
        .join("\n"),
      healPercent: null,
      charges: null,
      remaining: null,
    };
  }
  return { inventory: { ...inventory, backpack, details }, names: { ...names, items: itemNames } };
}
