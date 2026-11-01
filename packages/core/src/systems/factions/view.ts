import type { ViewContext } from "../../kernel/system";
import { formatGameTime, locationCatalog, WorldClockStateSchema } from "../world";
import { currentAttitude, factionCatalog } from "./apply";
import { attitudeLabel, FACTION_KIND_LABELS, FactionsStateSchema } from "./schema";
import { currentTurf } from "./turf";

/** 各势力对玩家的态度、听说了的地盘变化，和当前地点是谁的地盘 */
export function factionsView({ world, data }: ViewContext) {
  const { location } = WorldClockStateSchema.parse(world.slices.world);
  const catalog = factionCatalog(data);
  const state = FactionsStateSchema.parse(world.slices.factions ?? {});
  const place = location === null ? undefined : locationCatalog(data).get(location);
  const name = (id: string) => catalog.get(id)?.name ?? id;
  // 玩家只看得到传开了的地盘变化；势力的打算本身由【城里在发酵的事】交给玩家
  // （用户 2026-11-01 定的「全改」第 4 步：模型当主持人，代码只管记账）
  const turf = currentTurf(state, data, true);
  const newsOf = (faction: string) =>
    state.turf
      .filter((r) => r.told && r.faction === faction)
      .map((r) => ({
        turf: `${name(r.faction)}${r.change === "gain" ? "拿下了" : "丢了"}${r.district}`,
        at: r.at,
        time: formatGameTime(r.at),
      }))
      .sort((a, b) => b.at - a.at)
      .slice(0, 6);
  const list = [...catalog.values()].map((f) => {
    const attitude = currentAttitude(state, f);
    const stance = state.stances[f.id];
    const held = turf.get(f.id) ?? f.turf;
    return {
      id: f.id,
      name: f.name,
      en: f.en,
      kind: f.kind,
      kindLabel: FACTION_KIND_LABELS[f.kind],
      color: f.color,
      style: f.style,
      turf: held,
      /** 势力卡上原来的地盘；和 turf 不同说明地盘变过 */
      baseTurf: f.turf,
      turfNote: f.turfNote ?? null,
      allies: f.allies.map(name),
      enemies: f.enemies.map(name),
      attitude,
      attitudeLabel: attitudeLabel(f.kind, attitude),
      reason: stance?.reason ?? null,
      changedAt: stance ? formatGameTime(stance.at) : null,
      /** 当前地点所在的城区是它的地盘 */
      here: place !== undefined && held.includes(place.district),
      /** 传开了的动向，新的在前 */
      news: newsOf(f.id),
    };
  });
  return { list, district: place?.district ?? null };
}
