import type { EventContext, SystemEvent } from "../../kernel/system";
import { humanityView } from "./view";

/** 人性交的系统通知：阶段变了；人性数值的增减由界面的数值对比出 */
export function humanityEvents({ before, after }: EventContext): readonly SystemEvent[] {
  const was = humanityView(before);
  const now = humanityView(after);
  if (now.stage === was.stage) return [];
  return [
    {
      source: "humanity",
      icon: "attention",
      text: `人性阶段：${now.stageLabel}`,
      tone: now.current > was.current ? "good" : "bad",
    },
  ];
}
