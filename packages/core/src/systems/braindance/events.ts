import type { EventContext, SystemEvent } from "../../kernel/system";
import { BraindanceStateSchema } from "./schema";
import { braindanceView } from "./view";

/** 接入和结束只比公开视图；历史满了仍识别新记录，不透露结论对错 */
export function braindanceEvents({ before, after }: EventContext): readonly SystemEvent[] {
  const was = braindanceView(BraindanceStateSchema.parse(before.world.slices.braindance ?? {}));
  const now = braindanceView(BraindanceStateSchema.parse(after.world.slices.braindance ?? {}));
  const result: SystemEvent[] = [];
  const add = (text: string) =>
    result.push({ source: "braindance", icon: "braindance", text, tone: "info" });
  if (
    now.active &&
    (now.active.title !== was.active?.title || now.active.startedAt !== was.active?.startedAt)
  ) {
    add(`接上超梦：${now.active.title}`);
  }
  const finished = now.history.some(
    (h) =>
      !was.history.some((p) => p.startedAt === h.startedAt && p.at === h.at && p.title === h.title),
  );
  if (finished || (was.active && !now.active)) {
    add(was.active ? `超梦调查告一段落：${was.active.title}` : "超梦调查告一段落");
  }
  return result;
}
