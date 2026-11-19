import type { EventContext, SystemEvent } from "../../kernel/system";
import { traumaView } from "./view";

/** 购买、续期、升级、到期、退会及现场救援的公开通知。 */
export function traumaEvents({ before, after }: EventContext): readonly SystemEvent[] {
  const was = traumaView(before);
  const now = traumaView(after);
  const events: SystemEvent[] = [];
  if (now.tier !== was.tier || now.until !== was.until) {
    events.push({
      source: "trauma",
      icon: "attention",
      text: !now.active
        ? now.lapsed
          ? "创伤小组会籍过期了，保障已停止"
          : "创伤小组已退会，保障立即停止"
        : `创伤小组${now.tierLabel}${was.active && was.tier === now.tier ? "续费" : was.active ? "升级" : "开通"}：到 ${now.until}`,
      tone: now.active ? "good" : "bad",
    });
  }
  if (now.rescues > was.rescues)
    events.push({
      source: "trauma",
      icon: "attention",
      text: "创伤小组已完成现场生命体征稳定，具体伤口仍需恢复",
      tone: "good",
    });
  return events;
}
