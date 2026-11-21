import type { Threat, ViewContext } from "../../kernel/system";
import { locationCatalog, WorldClockStateSchema } from "../world";
import { currentAttitude, factionCatalog } from "./apply";
import { attitudeLabel, FactionsStateSchema } from "./schema";
import { currentTurf } from "./turf";

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

/**
 * 地盘伏击（用户 2026-10-31 选的「势力进机制」："能不能进它的地盘……伏击"）：
 * 人在见面就打的势力地盘里，他们随时会找上门；在敌对势力地盘里，可能被盯上、拦下盘问。
 * 代码按地盘和态度给出街上的气氛，什么时候、怎么出现由叙事模型看局面定
 * （用户 2026-11-01 定的「全改」第 3 步：原来是“这一场一定找上门”）
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
  // 叙事模型看到实际地盘变化（不限于玩家已听闻），玩家侧界面与威胁栏仍按 toldOnly 隔离
  const turf = currentTurf(state, data, false);
  const lines: string[] = [];
  for (const f of factionCatalog(data).values()) {
    if (!(turf.get(f.id) ?? f.turf).includes(place.district)) continue;
    const attitude = currentAttitude(state, f);
    if (attitude === "kos") {
      lines.push(
        `- ${f.name}（${f.id}）对玩家${attitudeLabel(f.kind, attitude)}，这里是它的地盘${place.district}：他们随时会找上门（埋伏、堵路、开枪），什么时候来、怎么来看局面，玩家躲进室内或飞快离开也只能拖一时；${f.kind === "corp" ? "公司派的是外包的打手或安保小队" : "来的是这个帮派的人"}，按对方的真实火力与人数写冲突`,
      );
    } else if (attitude === "hostile") {
      lines.push(
        `- ${f.name}（${f.id}）对玩家${attitudeLabel(f.kind, attitude)}，这里是它的地盘${place.district}：可能有人认出玩家、盯梢、拦下来盘问或要买路钱；玩家处理得不好就会打起来`,
      );
    } else if (attitude === "family" || attitude === "friendly") {
      lines.push(
        `- ${f.name}（${f.id}）对玩家${attitudeLabel(f.kind, attitude)}，这里是它的地盘${place.district}：街上的人给面子，有人罩着，打听消息容易`,
      );
    }
  }
  return lines.length > 0 ? lines.join("\n") : undefined;
}
