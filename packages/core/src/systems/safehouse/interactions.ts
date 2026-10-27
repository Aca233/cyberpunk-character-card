import type { Interaction, ViewContext } from "../../kernel/system";
import { WorldClockStateSchema } from "../world";
import { apartmentList, apartmentLocked } from "./apply";
import { SafehouseStateSchema } from "./schema";

/** 安全屋交的交互：在自己住处时打开存放箱；当前地点能买下的公寓各一条，钱够不够由操作校验 */
export function safehouseInteractions({ world, data }: ViewContext): readonly Interaction[] {
  const { location } = WorldClockStateSchema.parse(world.slices.world);
  if (location === null) return [];
  const state = SafehouseStateSchema.parse(world.slices.safehouse ?? {});
  const homes: Interaction[] = state.homes
    .filter((h) => h.location === location)
    .map((h) => ({
      id: `safehouse:stash:${h.id}`,
      source: "safehouse",
      label: `打开${h.name}的存放箱`,
      icon: "stash",
      panel: "stash",
      target: h.id,
    }));
  const forSale: Interaction[] = apartmentList(data)
    .filter((a) => a.location === location && apartmentLocked(state.homes, a) === undefined)
    .map((a) => ({
      id: `safehouse:buy:${a.id}`,
      source: "safehouse",
      label: `买下${a.name}`,
      icon: "home",
      panel: "buyHome",
      target: a.id,
    }));
  return [...homes, ...forSale];
}
