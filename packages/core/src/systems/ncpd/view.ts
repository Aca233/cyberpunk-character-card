import type { ViewContext } from "../../kernel/system";
import { formatGameTime, locationCatalog, WorldClockStateSchema } from "../world";
import { NcpdStateSchema } from "./schema";

/** 扫描器上挂着的 NCPD 警情；here 标玩家现在在不在这条警情的城区 */
export function ncpdView({ world, data }: ViewContext) {
  const { location } = WorldClockStateSchema.parse(world.slices.world);
  const state = NcpdStateSchema.parse(world.slices.ncpd ?? {});
  const places = locationCatalog(data);
  const here = location === null ? undefined : places.get(location);
  return {
    cleared: state.cleared,
    alerts: state.alerts.map((a) => {
      const place = places.get(a.location);
      return {
        id: a.id,
        label: a.label,
        note: a.note,
        district: a.district,
        location: a.location,
        locationName: place?.name ?? a.location,
        x: place?.x ?? null,
        y: place?.y ?? null,
        reward: a.reward,
        risk: a.risk,
        until: formatGameTime(a.expiresAt),
        /** 玩家现在就在这条警情的城区 */
        here: here?.district === a.district,
      };
    }),
  };
}
