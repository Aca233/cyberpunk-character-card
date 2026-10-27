import type { Interaction, ViewContext } from "../../kernel/system";
import { BraindanceStateSchema } from "./schema";

/** 超梦交的交互：正在查一段录像时，按 F 打开超梦体验编辑器；只给标题，不碰线索和答案 */
export function braindanceInteractions({ world }: ViewContext): readonly Interaction[] {
  const active = BraindanceStateSchema.parse(world.slices.braindance ?? {}).active;
  if (!active) return [];
  return [
    {
      id: "braindance:editor",
      source: "braindance",
      label: `接入超梦：${active.recording.title}`,
      icon: "braindance",
      panel: "braindance",
      target: null,
    },
  ];
}
