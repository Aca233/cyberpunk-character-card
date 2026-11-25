import type { ViewContext } from "../../kernel/system";
import { formatGameTime, locationCatalog, WorldClockStateSchema } from "../world";
import { currentAttitude, factionCatalog } from "./apply";
import { readNpcMap } from "./npcs";
import {
  attitudeLabel,
  FACTION_KIND_LABELS,
  FactionsStateSchema,
  MAX_FACTION_STRIKES,
} from "./schema";
import { currentTurf } from "./turf";

/** 各势力对玩家的态度、成员归属（靠山与污点）、内部派系、地盘争夺，以及关联真人 NPC */
export function factionsView({ world, data }: ViewContext) {
  const { location } = WorldClockStateSchema.parse(world.slices.world);
  const catalog = factionCatalog(data);
  const state = FactionsStateSchema.parse(world.slices.factions ?? {});
  const npcs = readNpcMap(world.slices.npc);
  const place = location === null ? undefined : locationCatalog(data).get(location);
  const name = (id: string) => catalog.get(id)?.name ?? id;
  const npcName = (id: string | undefined) => (id ? (npcs.get(id)?.name ?? id) : null);

  // 玩家只看得到传开了的地盘变化（玩家亲手触发的 told 默认为 true）
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

  const sponsorNpc = state.membership?.sponsor ? npcs.get(state.membership.sponsor) : undefined;
  const membership = state.membership
    ? {
        faction: state.membership.faction,
        name: name(state.membership.faction),
        rank: state.membership.rank,
        joinedAt: formatGameTime(state.membership.joinedAt),
        note: state.membership.note,
        sponsor: state.membership.sponsor ?? null,
        sponsorName: sponsorNpc?.name ?? state.membership.sponsor ?? null,
        sponsorAlive: sponsorNpc ? sponsorNpc.alive : !state.membership.sponsorLost,
        sponsorLost: state.membership.sponsorLost || (sponsorNpc ? !sponsorNpc.alive : false),
        strikes: state.membership.strikes.map((s) => ({
          at: s.at,
          time: formatGameTime(s.at),
          reason: s.reason,
          byNpc: s.byNpc ?? null,
          byNpcName: npcName(s.byNpc),
        })),
        maxStrikes: MAX_FACTION_STRIKES,
      }
    : null;

  const contested = Object.values(state.contested).map((c) => ({
    district: c.district,
    factions: c.factions,
    factionNames: c.factions.map(name),
    reason: c.reason,
    leadNpc: c.leadNpc ?? null,
    leadNpcName: npcName(c.leadNpc),
    time: formatGameTime(c.at),
  }));
  const hereContested = place
    ? (contested.find((c) => c.district === place.district) ?? null)
    : null;

  const list = [...catalog.values()].map((f) => {
    const attitude = currentAttitude(state, f);
    const stance = state.stances[f.id];
    const held = turf.get(f.id) ?? f.turf;
    const member = state.membership?.faction === f.id;

    // 内部派系状态与真实领袖 NPC 生死
    const wingState = state.wings[f.id];
    const rulingId = wingState?.ruling ?? f.wings[0]?.id ?? null;
    const playerWingId = wingState?.playerSide ?? null;
    const wings = f.wings.map((w) => {
      const isRuling = w.id === rulingId;
      const leaderIds = [
        ...(isRuling && wingState?.leaderNpc ? [wingState.leaderNpc] : []),
        ...w.leaders,
      ].filter((id, idx, arr) => arr.indexOf(id) === idx);
      const leaders = leaderIds.flatMap((id) => {
        const ref = npcs.get(id);
        return ref ? [{ id: ref.id, name: ref.name, alive: ref.alive, met: ref.met }] : [];
      });
      const primaryId = isRuling ? (wingState?.leaderNpc ?? w.leaders[0]) : w.leaders[0];
      const primaryRef = primaryId ? npcs.get(primaryId) : undefined;
      const vacant = isRuling && (wingState?.vacant || (primaryRef ? !primaryRef.alive : false));
      return {
        id: w.id,
        name: w.name,
        style: w.style,
        ruling: isRuling,
        vacant,
        playerSide: w.id === playerWingId,
        leaders,
      };
    });
    const rulingWing = wings.find((w) => w.ruling) ?? null;
    const playerWing = wings.find((w) => w.playerSide) ?? null;

    // 该势力在册的关键 NPC（优先已见过且活着 > 活着的核心人物 > 已亡故人物）
    const wingNameOfNpc = (id: string) => {
      for (const w of f.wings) {
        if (w.leaders.includes(id)) return w.name;
      }
      if (wingState?.leaderNpc === id && rulingWing) return rulingWing.name;
      return null;
    };
    const keyNpcs = [...npcs.values()]
      .filter((n) => n.faction === f.id || (member && state.membership?.sponsor === n.id))
      .sort((a, b) => {
        const score = (n: typeof a) =>
          (member && state.membership?.sponsor === n.id ? 8 : 0) +
          (n.alive ? 4 : 0) +
          (n.met ? 2 : 0) +
          (wingNameOfNpc(n.id) ? 1 : 0);
        return score(b) - score(a);
      })
      .slice(0, 6)
      .map((n) => ({
        id: n.id,
        name: n.name,
        role: n.role,
        alive: n.alive,
        met: n.met,
        isSponsor: member && state.membership?.sponsor === n.id,
        wingName: wingNameOfNpc(n.id),
      }));

    const contestedDistricts = contested
      .filter((c) => c.factions.includes(f.id))
      .map((c) => c.district);

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
      member,
      memberRank: member ? (state.membership?.rank ?? null) : null,
      reason: stance?.reason ?? null,
      changedAt: stance ? formatGameTime(stance.at) : null,
      /** 当前地点所在的城区是它的地盘 */
      here: place !== undefined && held.includes(place.district),
      /** 内部派系现状 */
      wings,
      rulingWingName: rulingWing?.name ?? null,
      rulingVacant: rulingWing?.vacant ?? false,
      playerWingName: playerWing?.name ?? null,
      wingNote: wingState?.note ?? null,
      /** 关联真人 NPC */
      keyNpcs,
      /** 正在火拼争夺中的城区 */
      contestedDistricts,
      /** 传开了的动向，新的在前 */
      news: newsOf(f.id),
    };
  });

  return { list, district: place?.district ?? null, membership, contested, hereContested };
}
