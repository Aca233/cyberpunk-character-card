import type { EventContext, SystemEvent } from "../../kernel/system";
import { cyberwareView } from "./view";

/** 只比较公开的义体视图：装上、卸下、损坏和修复 */
export function cyberwareEvents({ before, after }: EventContext): readonly SystemEvent[] {
  const was = new Map(cyberwareView(before).map((c) => [c.id, c]));
  const now = new Map(cyberwareView(after).map((c) => [c.id, c]));
  const result: SystemEvent[] = [];
  const add = (text: string, tone: SystemEvent["tone"]) =>
    result.push({ source: "cyberware", icon: "cyberware", text, tone });
  for (const c of now.values()) {
    const old = was.get(c.id);
    if (!old) {
      add(
        `${c.broken ? "装入的义体已损坏" : "新义体已上线"}：${c.name}`,
        c.broken ? "bad" : "good",
      );
    } else if (old.broken !== c.broken) {
      add(`${c.broken ? "义体已损坏" : "义体已修复"}：${c.name}`, c.broken ? "bad" : "good");
    }
  }
  for (const c of was.values()) {
    if (!now.has(c.id)) add(`义体已卸下：${c.name}`, "info");
  }
  return result;
}
