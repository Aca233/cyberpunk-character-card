import type { EventContext, SystemEvent } from "../../kernel/system";
import { ATTITUDES } from "./schema";
import { factionsView } from "./view";

/** 只通知玩家可见的势力变化：成员归属、污点、靠山阵亡、内部政变、地盘争夺与态度变化 */
export function factionsEvents({ before, after }: EventContext): readonly SystemEvent[] {
  const prevView = factionsView(before);
  const nextView = factionsView(after);
  const was = new Map(prevView.list.map((f) => [f.id, f]));
  const result: SystemEvent[] = [];

  if (prevView.membership?.faction !== nextView.membership?.faction) {
    if (nextView.membership) {
      result.push({
        source: "factions",
        icon: "attention",
        text: `加入${nextView.membership.name}（${nextView.membership.rank}）`,
        tone: "good",
      });
    } else if (prevView.membership) {
      result.push({
        source: "factions",
        icon: "warning",
        text: `脱离${prevView.membership.name}`,
        tone: "bad",
      });
    }
  } else if (prevView.membership && nextView.membership) {
    if (prevView.membership.rank !== nextView.membership.rank) {
      result.push({
        source: "factions",
        icon: "attention",
        text: `${nextView.membership.name}头衔：${nextView.membership.rank}`,
        tone: "good",
      });
    }
    if (!prevView.membership.sponsorLost && nextView.membership.sponsorLost) {
      result.push({
        source: "factions",
        icon: "warning",
        text: `当年引荐你入${nextView.membership.name}的${nextView.membership.sponsorName ?? "引荐人"}已故`,
        tone: "bad",
      });
    }
    if (nextView.membership.strikes.length > prevView.membership.strikes.length) {
      result.push({
        source: "factions",
        icon: "warning",
        text: `${nextView.membership.name}帮规污点 ${nextView.membership.strikes.length}/${nextView.membership.maxStrikes}`,
        tone: "bad",
      });
    } else if (nextView.membership.strikes.length < prevView.membership.strikes.length) {
      result.push({
        source: "factions",
        icon: "attention",
        text: `${nextView.membership.name}销去 1 笔污点（余 ${nextView.membership.strikes.length}/${nextView.membership.maxStrikes}）`,
        tone: "good",
      });
    }
  }

  // 新爆发的地盘火拼
  const prevContested = new Set(prevView.contested.map((c) => c.district));
  for (const c of nextView.contested) {
    if (!prevContested.has(c.district)) {
      result.push({
        source: "factions",
        icon: "warning",
        text: `${c.district}爆发地盘火拼（${c.factionNames.join(" vs ")}）`,
        tone: "bad",
      });
    }
  }

  for (const f of nextView.list) {
    const old = was.get(f.id);
    if (!old) continue;
    if (old.attitude !== f.attitude) {
      result.push({
        source: "factions",
        icon: "attention",
        text: `${f.name}：${f.attitudeLabel}`,
        tone: ATTITUDES.indexOf(f.attitude) > ATTITUDES.indexOf(old.attitude) ? "good" : "bad",
      });
    }
    if (old.rulingWingName !== f.rulingWingName && f.rulingWingName) {
      result.push({
        source: "factions",
        icon: "attention",
        text: `${f.name}内部易主：${f.rulingWingName}掌权`,
        tone: "good",
      });
    } else if (!old.rulingVacant && f.rulingVacant) {
      result.push({
        source: "factions",
        icon: "warning",
        text: `${f.name}掌权领袖身亡，内部陷入权力真空`,
        tone: "bad",
      });
    }
    if (old.playerWingName !== f.playerWingName && f.playerWingName) {
      result.push({
        source: "factions",
        icon: "attention",
        text: `站队${f.name}·${f.playerWingName}`,
        tone: "good",
      });
    }
  }

  return result;
}
