import type { ViewContext } from "../../kernel/system";
import { formatGameTime, locationCatalog, WorldClockStateSchema } from "../world";
import { agendaCatalog, currentTurf, progressOf } from "./agenda";
import { currentAttitude, factionCatalog } from "./apply";
import {
  AGENDA_OUTCOME_LABELS,
  attitudeLabel,
  FACTION_KIND_LABELS,
  FactionsStateSchema,
} from "./schema";

/** 各势力对玩家的态度、传开了的动向，和当前地点是谁的地盘 */
export function factionsView({ world, data }: ViewContext) {
  const { location } = WorldClockStateSchema.parse(world.slices.world);
  const catalog = factionCatalog(data);
  const state = FactionsStateSchema.parse(world.slices.factions ?? {});
  const place = location === null ? undefined : locationCatalog(data).get(location);
  const name = (id: string) => catalog.get(id)?.name ?? id;
  // 玩家只看得到传开了的：地盘按听说了的变化算，动向只列听说了的几步；到点没推演的、没传开的都不进视图
  const turf = currentTurf(state, data, true);
  const seeds = [...agendaCatalog(data).values()];
  const newsOf = (faction: string) =>
    seeds
      .filter((s) => s.faction === faction)
      .flatMap((s) =>
        progressOf(state, s.id)
          .moves.filter((m) => m.told)
          .map((m) => ({
            agenda: s.title,
            title: m.title,
            news: m.news,
            label: m.kind === "move" ? AGENDA_OUTCOME_LABELS[m.outcome ?? "twist"] : `你${m.title}`,
            mine: m.kind !== "move",
            turf: m.turf
              ? `${name(m.turf.faction)}${m.turf.change === "gain" ? "拿下了" : "丢了"}${m.turf.district}`
              : null,
            at: m.at,
            time: formatGameTime(m.at),
          })),
      )
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
