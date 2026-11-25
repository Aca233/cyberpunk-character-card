import type { Threat, ViewContext } from "../../kernel/system";
import { locationCatalog, WorldClockStateSchema } from "../world";
import { currentAttitude, factionCatalog } from "./apply";
import { readNpcMap } from "./npcs";
import { attitudeLabel, FactionsStateSchema, MAX_FACTION_STRIKES } from "./schema";
import { currentTurf } from "./turf";

/** 态度对应的威胁等级；中立以上不算威胁 */
const ATTITUDE_LEVEL: Readonly<Record<string, number>> = { kos: 3, hostile: 1 };

/**
 * 势力交的威胁：见面就打和敌对的势力各一条；人在它的地盘里多一级；
 * 若当前城区处于地盘火拼争夺中，另给一条火拼态势提醒。
 */
export function factionsThreats({ world, data }: ViewContext): readonly Threat[] {
  const { location } = WorldClockStateSchema.parse(world.slices.world);
  const state = FactionsStateSchema.parse(world.slices.factions ?? {});
  const place = location === null ? undefined : locationCatalog(data).get(location);
  const catalog = factionCatalog(data);
  const turf = currentTurf(state, data, true);
  const result: Threat[] = [];

  if (place) {
    const war = state.contested[place.district];
    if (war) {
      const names = war.factions.map((id) => catalog.get(id)?.name ?? id).join(" / ");
      result.push({
        id: `factions:contested:${place.district}`,
        source: "factions",
        sourceLabel: "地盘火拼",
        who: `${place.district}争夺区`,
        level: 2,
        reason: `${names}正在争夺此地：${war.reason}`,
      });
    }
  }

  for (const f of catalog.values()) {
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

/**
 * 【这里是谁的地盘】：给叙事模型渲染当前城区的街头氛围、掌权派系风格、权力真空、
 * 成员靠山/污点与正在发生的地盘火拼。
 */
export function turfSection({
  world,
  data,
}: Pick<ViewContext, "world" | "data">): string | undefined {
  const { location } = WorldClockStateSchema.parse(world.slices.world);
  if (location === null) return undefined;
  const place = locationCatalog(data).get(location);
  if (place === undefined) return undefined;
  const state = FactionsStateSchema.parse(world.slices.factions ?? {});
  const catalog = factionCatalog(data);
  const npcs = readNpcMap(world.slices.npc);
  const turf = currentTurf(state, data, false);
  const memberOf = state.membership?.faction ?? null;
  const memberRank = state.membership?.rank ?? null;
  const lines: string[] = [];

  const war = state.contested[place.district];
  if (war) {
    const names = war.factions.map((id) => catalog.get(id)?.name ?? id).join(" 与 ");
    const lead = war.leadNpc ? npcs.get(war.leadNpc)?.name : undefined;
    lines.push(
      `- 【地盘火拼争夺中】${place.district}眼下正爆发地盘争夺（${names}${lead ? `，核心人物：${lead}` : ""}，缘由：${war.reason}）：街口设卡增多、店铺拉闸提价（货源紧张 +15%）、流弹与武装盘查频发，玩家可趁乱浑水摸鱼、拉偏架或直接帮一方彻底拿下/逐出这片地盘`,
    );
  }

  for (const f of catalog.values()) {
    if (!(turf.get(f.id) ?? f.turf).includes(place.district)) continue;
    const attitude = currentAttitude(state, f);
    const wingState = state.wings[f.id];
    const rulingDef =
      f.wings.find((w) => w.id === (wingState?.ruling ?? f.wings[0]?.id)) ?? f.wings[0];
    const primaryLeaderId = wingState?.leaderNpc ?? rulingDef?.leaders[0];
    const primaryLeader = primaryLeaderId ? npcs.get(primaryLeaderId) : undefined;
    const isVacant =
      Boolean(wingState?.vacant) || (primaryLeader !== undefined && !primaryLeader.alive);
    const wingNote = rulingDef
      ? isVacant
        ? `；当前由「${rulingDef.name}」名义掌权，但核心领袖${primaryLeader ? primaryLeader.name : ""}已亡、内部群龙无首、防务松动（可趁机端据点或扶持新派上位）`
        : `；当前掌权派为「${rulingDef.name}」（${rulingDef.style}）`
      : "";

    if (memberOf === f.id) {
      const m = state.membership;
      const sponsorRef = m?.sponsor ? npcs.get(m.sponsor) : undefined;
      const sponsorLost =
        Boolean(m?.sponsorLost) || (sponsorRef !== undefined && !sponsorRef.alive);
      const sponsorNote = sponsorRef
        ? sponsorLost
          ? `；当年引荐你入伙的${sponsorRef.name}已故（是否影响你在帮内的处境完全看你如今的头衔、实力与威望：羽翼未丰时可能少个照应，若你自己已是高层或镇得住场子，反而由你稳局或接盘）`
          : `；当年引荐你入伙的是${sponsorRef.name}`
        : "";
      const strikesCount = m?.strikes.length ?? 0;
      const strikeNote =
        strikesCount > 0
          ? `；你眼下背着 ${strikesCount}/${MAX_FACTION_STRIKES} 笔帮规污点（${strikesCount >= 2 ? "已到最后通牒边缘，同伙盯得很紧" : "内部已有警告风声"}）`
          : "";
      lines.push(
        `- 你是${f.name}（${f.id}）的正式成员「${memberRank}」，这里（${place.district}）是本组织地盘：门禁与暗哨放行、内部打听消息与暂避风头都好说话、出事可就近喊同伙照应${sponsorNote}${strikeNote}${wingNote}`,
      );
    } else if (attitude === "kos") {
      lines.push(
        `- ${f.name}（${f.id}）对玩家${attitudeLabel(f.kind, attitude)}，这里是它的地盘${place.district}：他们随时会找上门（埋伏、堵路、开枪），什么时候来、怎么来看局面；${f.kind === "corp" ? "公司派的是外包的打手或安保小队" : "来的是这个帮派的人"}，按对方的真实火力与人数写冲突${wingNote}`,
      );
    } else if (attitude === "hostile") {
      lines.push(
        `- ${f.name}（${f.id}）对玩家${attitudeLabel(f.kind, attitude)}，这里是它的地盘${place.district}：可能有人认出玩家、盯梢、拦下来盘问或要买路钱；处理得不好就会打起来${wingNote}`,
      );
    } else if (attitude === "family") {
      lines.push(
        `- ${f.name}（${f.id}）把玩家当「${attitudeLabel(f.kind, attitude)}」，这里是它的地盘${place.district}：进出稳当、可走内部门路打听隐秘消息或借场子暂避风头，找他们的人办事也肯给实打实人情${wingNote}`,
      );
    } else if (attitude === "friendly") {
      lines.push(
        `- ${f.name}（${f.id}）对玩家${attitudeLabel(f.kind, attitude)}，这里是它的地盘${place.district}：街上的人给面子，打听消息顺手，旗下店铺照常给熟客折扣${wingNote}`,
      );
    } else if (isVacant && rulingDef) {
      lines.push(
        `- ${f.name}（${f.id}）控制着${place.district}，眼下因${primaryLeader ? `${primaryLeader.name}身亡` : "首领出事"}正处权力真空，内部派系摩擦频繁、地盘巡逻松动`,
      );
    }
  }
  return lines.length > 0 ? lines.join("\n") : undefined;
}
