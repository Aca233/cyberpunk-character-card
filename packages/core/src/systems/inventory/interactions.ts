import type { Interaction, ViewContext } from "../../kernel/system";
import { WorldClockStateSchema } from "../world";
import { shopList } from "./apply";

/** 商店交的交互：当前地点开着的每一家店一条，按 F 打开那家店 */
export function inventoryInteractions({ world, data }: ViewContext): readonly Interaction[] {
  const { location } = WorldClockStateSchema.parse(world.slices.world);
  if (location === null || data.items === undefined) return [];
  return shopList(data)
    .filter((s) => s.location === location)
    .map((s) => ({
      id: `inventory:shop:${s.id}`,
      source: "inventory",
      label: `进${s.name}`,
      icon: "shop",
      panel: "shop",
      target: s.id,
    }));
}
