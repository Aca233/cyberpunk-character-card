import type { EventContext, SystemEvent } from "../../kernel/system";
import { itemCatalog } from "./apply";
import { type InventoryState, InventoryStateSchema, type ItemDef } from "./schema";

/** 合计背包和装备中的实物，换装、切武器和装卸改装件不改变总数 */
function carriedCounts(state: InventoryState): Map<string, number> {
  const counts = new Map(Object.entries(state.backpack));
  const add = (id: string | null | undefined) => {
    if (id != null) counts.set(id, (counts.get(id) ?? 0) + 1);
  };
  for (const id of state.weapons) add(id);
  add(state.healing?.id);
  add(state.grenade?.id);
  for (const id of Object.values(state.clothing)) add(id);
  for (const [weapon, fitted] of Object.entries(state.mods)) {
    if (!state.weapons.includes(weapon) && (state.backpack[weapon] ?? 0) < 1) continue;
    for (const id of Object.values(fitted)) add(id);
  }
  return counts;
}

/** 背包交的系统通知：每样东西多了或少了几件；装上、卸下在武器格和背包之间挪不算得失 */
export function inventoryEvents({ before, after }: EventContext): readonly SystemEvent[] {
  const was = Object.fromEntries(
    carriedCounts(InventoryStateSchema.parse(before.world.slices.inventory)),
  );
  const now = Object.fromEntries(
    carriedCounts(InventoryStateSchema.parse(after.world.slices.inventory)),
  );
  const items =
    after.data.items === undefined ? new Map<string, ItemDef>() : itemCatalog(after.data);
  const result: SystemEvent[] = [];
  for (const id of new Set([...Object.keys(was), ...Object.keys(now)])) {
    const delta = (now[id] ?? 0) - (was[id] ?? 0);
    if (delta === 0) continue;
    const name = items.get(id)?.name ?? id;
    result.push({
      source: "inventory",
      icon: "inventory",
      text: delta > 0 ? `获得 ${name} ×${delta}` : `失去 ${name} ×${-delta}`,
      tone: delta > 0 ? "good" : "bad",
    });
  }
  return result;
}
