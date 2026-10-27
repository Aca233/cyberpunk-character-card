import type { EventContext, SystemEvent } from "../../kernel/system";
import { ATTITUDES } from "./schema";
import { factionsView } from "./view";

/** 只通知玩家可见的势力态度变化；未公开的动向、地盘变化和后续打算不进来 */
export function factionsEvents({ before, after }: EventContext): readonly SystemEvent[] {
  const was = new Map(factionsView(before).list.map((f) => [f.id, f]));
  const result: SystemEvent[] = [];
  for (const f of factionsView(after).list) {
    const old = was.get(f.id);
    if (!old || old.attitude === f.attitude) continue;
    result.push({
      source: "factions",
      icon: "attention",
      text: `${f.name}：${f.attitudeLabel}`,
      tone: ATTITUDES.indexOf(f.attitude) > ATTITUDES.indexOf(old.attitude) ? "good" : "bad",
    });
  }
  return result;
}
