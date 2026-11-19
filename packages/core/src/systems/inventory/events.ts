import type { EventContext, SystemEvent } from "../../kernel/system";
import { itemCatalog, withWorldObjects } from "./apply";
import { type InventoryState, InventoryStateSchema, type ItemDef } from "./schema";

/** 合计背包和装备中的实物：将定制实例 wpn:* 归并回基础模板并计入已装改装件，换装与装卸不误报得失 */
function carriedCounts(state: InventoryState): Map<string, number> {
  const counts = new Map<string, number>();
  const add = (id: string | null | undefined, qty = 1) => {
    if (id == null || qty <= 0) return;
    const baseId = state.objects[id]?.baseId ?? id;
    counts.set(baseId, (counts.get(baseId) ?? 0) + qty);
  };
  for (const [id, count] of Object.entries(state.backpack)) {
    if (count < 1) continue;
    const obj = state.objects[id];
    if (obj?.kind === "customized" && obj.weaponState) {
      add(obj.weaponState.baseId, count);
      for (const modId of Object.values(obj.weaponState.mods)) {
        add(modId, count);
      }
    } else {
      add(id, count);
      if (obj?.weaponState) {
        for (const modId of Object.values(obj.weaponState.mods)) {
          add(modId, count);
        }
      }
    }
  }
  if (state.healing && state.healing.charges > 0) add(state.healing.id);
  if (state.grenade && state.grenade.charges > 0) add(state.grenade.id);
  for (const id of Object.values(state.clothing)) add(id);
  return counts;
}

/** 背包交的系统通知：每样东西多了或少了几件；穿脱衣服、快捷栏挪动或在身上装卸配件不算得失 */
export function inventoryEvents({ before, after }: EventContext): readonly SystemEvent[] {
  const beforeInv = InventoryStateSchema.parse(before.world.slices.inventory);
  const afterInv = InventoryStateSchema.parse(after.world.slices.inventory);
  const was = Object.fromEntries(carriedCounts(beforeInv));
  const now = Object.fromEntries(carriedCounts(afterInv));
  const items =
    after.data.items === undefined
      ? new Map<string, ItemDef>()
      : itemCatalog(withWorldObjects(after.data, afterInv.objects));
  const result: SystemEvent[] = [];
  for (const id of new Set([...Object.keys(was), ...Object.keys(now)])) {
    const delta = (now[id] ?? 0) - (was[id] ?? 0);
    if (delta === 0) continue;
    const name =
      items.get(id)?.name ??
      afterInv.objects[id]?.definition.name ??
      beforeInv.objects[id]?.definition.name ??
      id;
    result.push({
      source: "inventory",
      icon: "inventory",
      text: delta > 0 ? `获得 ${name} ×${delta}` : `失去 ${name} ×${-delta}`,
      tone: delta > 0 ? "good" : "bad",
    });
  }
  return result;
}
