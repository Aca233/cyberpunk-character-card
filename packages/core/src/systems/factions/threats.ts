import type { Threat, ViewContext } from "../../kernel/system";
import { locationCatalog, WorldClockStateSchema } from "../world";
import { currentTurf } from "./agenda";
import { currentAttitude, factionCatalog } from "./apply";
import { attitudeLabel, FactionsStateSchema } from "./schema";

/** 态度对应的威胁等级；中立以上不算威胁 */
const ATTITUDE_LEVEL: Readonly<Record<string, number>> = { kos: 3, hostile: 1 };

/**
 * 势力交的威胁：见面就打和敌对的势力各一条；人在它的地盘里多一级。
 * 地盘按玩家听说了的变化算，和势力页一致
 */
export function factionsThreats({ world, data }: ViewContext): readonly Threat[] {
  const { location } = WorldClockStateSchema.parse(world.slices.world);
  const state = FactionsStateSchema.parse(world.slices.factions ?? {});
  const place = location === null ? undefined : locationCatalog(data).get(location);
  const turf = currentTurf(state, data, true);
  const result: Threat[] = [];
  for (const f of factionCatalog(data).values()) {
    const attitude = currentAttitude(state, f);
    const base = ATTITUDE_LEVEL[attitude];
    if (base === undefined) continue;
    const here = place !== undefined && (turf.get(f.id) ?? f.turf).includes(place.district);
    const reason = state.stances[f.id]?.reason;
    result.push({
      id: `factions:${f.id}`,
      source: "factions",
      sourceLabel: "势力",
      who: f.name,
      level: base + (here ? 1 : 0),
      reason: `${attitudeLabel(f.kind, attitude)}${reason ? `：${reason}` : ""}${here ? `；你在它的地盘${place.district}` : ""}`,
    });
  }
  return result;
}
