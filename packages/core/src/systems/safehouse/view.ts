import type { ViewContext } from "../../kernel/system";
import { itemCatalog } from "../inventory";
import { locationCatalog, WorldClockStateSchema } from "../world";
import { apartmentList, apartmentLocked, trunks } from "./apply";
import { SafehouseStateSchema } from "./schema";

/** 安全屋、存放箱、后备箱，和当前地点能买下的公寓 */
export function safehouseView({ world, data }: ViewContext) {
  const { location } = WorldClockStateSchema.parse(world.slices.world);
  const state = SafehouseStateSchema.parse(world.slices.safehouse ?? {});
  const names = itemCatalog(data);
  const places = locationCatalog(data);
  const list = (id: string) =>
    Object.entries(state.stash[id] ?? {}).map(([item, count]) => ({
      id: item,
      name: names.get(item)?.name ?? item,
      count,
    }));
  const travel = world.slices.travel as
    | { vehicles?: Parameters<typeof trunks>[0]["vehicles"] }
    | undefined;
  return {
    homes: state.homes.map((h) => ({
      id: h.id,
      name: h.name,
      location: h.location,
      locationName: places.get(h.location)?.name ?? h.location,
      here: h.location === location,
      items: list(h.id),
    })),
    trunks: trunks({ vehicles: travel?.vehicles ?? [] }, data).map((t) => ({
      id: t.id,
      name: t.name,
      cap: t.kind === "trunk" ? t.cap : 0,
      items: list(t.id),
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
