import type { ViewContext } from "../../kernel/system";
import { HeatStateSchema } from "../heat";
import { formatGameTime, locationCatalog, WorldClockStateSchema } from "../world";
import { resolveAlertFaction } from "./apply";
import { NCPD_BOUNTY_BLOCK_STARS, NcpdStateSchema } from "./schema";

/** 扫描器上挂着的 NCPD 警情；附带涉事帮派势力、火拼区态势与高星通缉赏金冻结状态 */
export function ncpdView({ world, data }: ViewContext) {
  const { location } = WorldClockStateSchema.parse(world.slices.world);
  const state = NcpdStateSchema.parse(world.slices.ncpd ?? {});
  const heat = HeatStateSchema.parse(world.slices.heat ?? {});
  const bountyFrozen = heat.stars >= NCPD_BOUNTY_BLOCK_STARS;
  const places = locationCatalog(data);
  const here = location === null ? undefined : places.get(location);
  return {
    cleared: state.cleared,
    bountyFrozen,
    alerts: state.alerts.map((a) => {
      const place = places.get(a.location);
      const fctx = resolveAlertFaction(a, data, world.slices.factions);
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
        targetFactionId: fctx.targetFactionId,
        targetFactionName: fctx.targetFactionName,
        targetAttitude: fctx.targetAttitude,
        targetAttitudeLabel: fctx.targetAttitudeLabel,
        isOwnFaction: fctx.isOwnFaction,
        contested: fctx.contested,
        bountyFrozen,
        /** 玩家现在就在这条警情的城区 */
        here: here?.district === a.district,
      };
    }),
  };
}
