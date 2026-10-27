import type { EventContext, SystemEvent } from "../../kernel/system";
import { worldView } from "./view";

/** 世界交的系统通知：新加的期限、刚到期的、处理掉的；只比玩家视图里还没处理的期限 */
export function worldEvents({ before, after }: EventContext): readonly SystemEvent[] {
  const was = new Map(worldView(before).deadlines.map((d) => [d.id, d]));
  const now = worldView(after).deadlines;
  const result: SystemEvent[] = [];
  for (const d of now) {
    const old = was.get(d.id);
    if (!old) {
      result.push({
        source: "world",
        icon: "journal",
        text: `新期限：${d.label}（${d.due}）`,
        tone: "info",
      });
    } else if (d.overdue && !old.overdue) {
      result.push({ source: "world", icon: "timeCircle", text: `已到期：${d.label}`, tone: "bad" });
    }
  }
  for (const d of was.values()) {
    if (!now.some((n) => n.id === d.id)) {
      result.push({
        source: "world",
        icon: "questUpdate",
        text: `已处理：${d.label}`,
        tone: "info",
      });
    }
  }
  return result;
}
