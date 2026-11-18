import type { ViewContext } from "../../kernel/system";
import { locationCatalog, WorldClockStateSchema } from "../world";
import { apartmentList, apartmentLocked } from "./apply";
import { SafehouseStateSchema } from "./schema";

/** 供叙事状态和界面读取的住所与当前地点可买的公寓 */
export function safehouseView({ world, data }: ViewContext) {
  const { location } = WorldClockStateSchema.parse(world.slices.world);
  const state = SafehouseStateSchema.parse(world.slices.safehouse ?? {});
  const places = locationCatalog(data);
  return {
    homes: state.homes.map((h) => ({
      id: h.id,
      name: h.name,
      location: h.location,
      locationName: places.get(h.location)?.name ?? h.location,
      here: h.location === location,
    })),
    /** 当前地点能买下的公寓；locked 是买不了的原因（已经有住处），钱够不够由界面比 */
    forSale: apartmentList(data)
      .filter((a) => a.location === location)
      .map((a) => ({
        id: a.id,
        name: a.name,
        price: a.price,
        note: a.note,
        locked: apartmentLocked(state.homes, a) ?? null,
      })),
  };
}
