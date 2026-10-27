import type { EventContext, SystemEvent } from "../../kernel/system";
import { ATTRIBUTE_LABELS, type Attribute } from "../dice";
import { characterView } from "./view";

/** 属性点增加和属性提升；街头声望的数值变化留给 HUD 对比 */
export function characterEvents({ before, after }: EventContext): readonly SystemEvent[] {
  const was = characterView(before);
  const now = characterView(after);
  const result: SystemEvent[] = [];
  const points = now.attributePoints - was.attributePoints;
  if (points > 0) {
    result.push({
      source: "character",
      icon: "streetCred",
      text: `得到 ${points} 个属性点`,
      tone: "good",
    });
  }
  for (const [key, value] of Object.entries(now.attributes)) {
    const attribute = key as Attribute;
    const old = was.attributes[attribute];
    if (old === undefined || value === undefined || value <= old) continue;
    result.push({
      source: "character",
      icon: "attention",
      text: `${ATTRIBUTE_LABELS[attribute]} +${value - old}（${value}）`,
      tone: "good",
    });
  }
  return result;
}
