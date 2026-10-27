import type { EventContext, SystemEvent } from "../../kernel/system";
import { NEMESIS_STYLE_LABELS, NemesisStateSchema } from "./schema";

/** 宿敌出现和准备被看穿；未公开的准备与场外动静不触发通知 */
export function nemesisEvents({ before, after }: EventContext): readonly SystemEvent[] {
  const was = new Map(
    NemesisStateSchema.parse(before.world.slices.nemesis ?? {}).nemeses.map((n) => [n.npc, n]),
  );
  const result: SystemEvent[] = [];
  for (const n of NemesisStateSchema.parse(after.world.slices.nemesis ?? {}).nemeses) {
    const old = was.get(n.npc);
    const prep = n.known ? n.prep : null;
    const previous = old?.known ? old.prep : null;
    if (!old) {
      result.push({
        source: "nemesis",
        icon: "attention",
        text: `${n.name}成了你的宿敌`,
        tone: "bad",
      });
    } else if (prep && (prep.text !== previous?.text || prep.against !== previous?.against)) {
      result.push({
        source: "nemesis",
        icon: "attention",
        text: `看穿了${n.name}的准备：专克${NEMESIS_STYLE_LABELS[prep.against]}：${prep.text}`,
        tone: "info",
      });
    }
  }
  return result;
}
