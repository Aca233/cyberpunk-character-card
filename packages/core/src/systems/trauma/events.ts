import type { EventContext, SystemEvent } from "../../kernel/system";
import { traumaView } from "./view";

/** 创伤小组交的系统通知：会籍办了、升了、过期了或退掉了 */
export function traumaEvents({ before, after }: EventContext): readonly SystemEvent[] {
  const was = traumaView(before);
  const now = traumaView(after);
  if (now.tier === was.tier) return [];
  return [
    {
      source: "trauma",
      icon: "attention",
      text:
        now.tier === "none"
          ? now.lapsed
            ? "创伤小组会籍过期了"
            : "退掉了创伤小组会籍"
          : `创伤小组${now.tierLabel}：到 ${now.until}`,
      tone: now.tier === "none" ? "bad" : "good",
    },
  ];
}
