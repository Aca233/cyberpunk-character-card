import type { EventContext, SystemEvent } from "../../kernel/system";
import { BD_LAYER_LABELS, BD_MODE_LABELS, BraindanceStateSchema } from "./schema";

export function braindanceEvents({ before, after }: EventContext): readonly SystemEvent[] {
  const was = BraindanceStateSchema.parse(before.world.slices.braindance ?? {});
  const now = BraindanceStateSchema.parse(after.world.slices.braindance ?? {});
  const events: SystemEvent[] = [];
  if (now.active && now.active.id !== was.active?.id) {
    events.push({
      source: "braindance",
      icon: "braindance",
      text: `接上超梦：${now.works[now.active.work]?.title ?? now.active.work}（${BD_MODE_LABELS[now.active.mode]}）`,
      tone: "info",
    });
  }
  for (const d of now.discoveries.filter(
    (entry) => !was.discoveries.some((p) => p.work === entry.work && p.detail === entry.detail),
  )) {
    events.push({
      source: "braindance",
      icon: "braindance",
      text: `${BD_LAYER_LABELS[d.layer]}发现：${d.finding.slice(0, 36)}`,
      tone: "good",
    });
  }
  for (const h of now.history.filter((h) => !was.history.some((p) => p.id === h.id))) {
    events.push({
      source: "braindance",
      icon: "braindance",
      text: `${h.outcome === "finished" ? "看完" : "退出"}超梦：${now.works[h.work]?.title ?? h.work}`,
      tone: "info",
    });
  }
  return events;
}
