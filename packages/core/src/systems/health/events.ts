import type { EventContext, SystemEvent } from "../../kernel/system";
import { healthView } from "./view";

/** 生命交的系统通知：状态变了（倒下、濒死、起来）；生命数值的增减由界面的数值对比出 */
export function healthEvents({ before, after }: EventContext): readonly SystemEvent[] {
  const was = healthView(before);
  const now = healthView(after);
  const result: SystemEvent[] = [];
  if (now.condition !== was.condition) {
    result.push({
      source: "health",
      icon: "condition",
      text: `状态：${now.conditionLabel}`,
      tone: now.condition === "up" ? "good" : "bad",
    });
  }
  const lost = now.lostLimbs.filter((l) => !was.lostLimbs.some((w) => w.id === l.id));
  for (const l of lost) {
    result.push({ source: "health", icon: "limb", text: `失去了${l.label}`, tone: "bad" });
  }
  return result;
}
